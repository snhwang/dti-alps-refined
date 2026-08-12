"""
Rotation invariance, checked rather than asserted.

The claim the orientation-aware variants rest on is that rotating the head
cannot change them, because their measurement axes are estimated from the same
data that rotated. That is an algebraic consequence of the construction, not a
statistical tendency, so it should hold to machine precision and is worth
testing as such: if a variant is ever reported as invariant and is not, this is
where it shows up.

Runs on synthetic tensors, so it needs no data and no FSL.

    python tests/test_invariance.py

Expected: classic moves with rotation, cross / measured / voxelwise do not, and
ALPS-PAS moves because it selects its eigenvector by the scanner-x component and
is therefore invariant about x alone.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dti_alps_refined.alps import alps_from_volumes, L_SCR, R_SCR, L_SLF, R_SLF

TOL = 1e-9          # what "exactly invariant" has to mean
ANGLES = (5.0, 10.0, 20.0, 30.0)


def rotation(axis: str, degrees: float) -> np.ndarray:
    t = np.radians(degrees)
    c, s = np.cos(t), np.sin(t)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], float)
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], float)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], float)


def synthetic(seed: int = 20260812):
    """A small volume with the geometry the index assumes.

    Projection fibres run superior-inferior, association fibres
    anterior-posterior, and both carry a little orientation scatter so the
    direction estimate has something to average. Perivascular anisotropy is put
    in as a genuine excess of lambda2 over lambda3.
    """
    rng = np.random.default_rng(seed)
    shape = (24, 24, 12)
    evals = np.zeros(shape + (3,))
    evecs = np.zeros(shape + (3, 3))
    rois = np.zeros(shape, int)

    def fill(mask, primary, label, scatter=8.0):
        idx = np.argwhere(mask)
        for i, j, k in idx:
            # a fibre direction near `primary`, with scatter
            v = primary + np.radians(scatter) * rng.normal(size=3)
            v /= np.linalg.norm(v)
            # The second eigenvector is put as close to scanner x as it can be
            # while staying perpendicular to the fibre, which is the geometry
            # the index assumes: perivascular spaces running left-right across
            # tracts that run superior-inferior and anterior-posterior. Without
            # this the perpendicular plane has no preferred direction and the
            # index comes out below one, which no real brain does.
            e2 = np.array([1.0, 0.0, 0.0]) - float(np.dot([1.0, 0.0, 0.0], v)) * v
            e2 /= np.linalg.norm(e2)
            e3 = np.cross(v, e2)
            lam = np.array([1.7e-3,
                            0.85e-3 * (1 + 0.15 * rng.normal()),
                            0.55e-3 * (1 + 0.15 * rng.normal())])
            evals[i, j, k] = lam
            evecs[i, j, k] = np.column_stack([v, e2, e3])
            rois[i, j, k] = label

    z = np.zeros(shape, bool)
    z[6:10, 10:14, 4:8] = True                      # left projection
    fill(z, np.array([0.0, 0.0, 1.0]), L_SCR)
    z[:] = False; z[14:18, 10:14, 4:8] = True       # right projection
    fill(z, np.array([0.0, 0.0, 1.0]), R_SCR)
    z[:] = False; z[6:10, 4:8, 4:8] = True          # left association
    fill(z, np.array([0.0, 1.0, 0.0]), L_SLF)
    z[:] = False; z[14:18, 4:8, 4:8] = True         # right association
    fill(z, np.array([0.0, 1.0, 0.0]), R_SLF)

    # RAS+ affine with 2 mm voxels, centred so that x < 0 is the left half
    affine = np.diag([2.0, 2.0, 2.0, 1.0])
    affine[:3, 3] = [-shape[0], -shape[1], -shape[2]]
    return evals, evecs, affine, rois


def rotate_tensors(evecs: np.ndarray, R: np.ndarray) -> np.ndarray:
    """Rotate every tensor. Eigenvalues are unchanged by rotation; only the
    eigenvector frame turns, which is the whole point."""
    return np.einsum("ij,...jk->...ik", R, evecs)


def main() -> int:
    evals, evecs, affine, rois = synthetic()
    base = alps_from_volumes(evals, evecs, affine, rois)["combined"]

    variants = ("classic", "cross", "measured", "voxelwise", "alps_pas")
    should_be_invariant = {"cross", "measured", "voxelwise"}

    print(f"{'axis':<6s} {'deg':>5s} " + " ".join(f"{v:>12s}" for v in variants))
    print(f"{'':6s} {'0':>5s} " + " ".join(f"{base[v]:12.6f}" for v in variants))

    worst = {v: 0.0 for v in variants}
    for axis in ("x", "y", "z"):
        for deg in ANGLES:
            got = alps_from_volumes(evals, rotate_tensors(evecs, rotation(axis, deg)),
                                    affine, rois)["combined"]
            drift = {v: abs(got[v] - base[v]) / abs(base[v]) for v in variants}
            for v in variants:
                worst[v] = max(worst[v], drift[v])
            print(f"{axis:<6s} {deg:5.0f} " + " ".join(f"{got[v]:12.6f}" for v in variants))

    print("\nlargest relative change over all rotations")
    ok = True
    for v in variants:
        verdict = ""
        if v in should_be_invariant:
            good = worst[v] < TOL
            verdict = "  invariant" if good else "  <-- SHOULD BE INVARIANT"
            ok &= good
        elif worst[v] < TOL:
            verdict = "  <-- unexpectedly invariant, check the test"
            ok = False
        else:
            verdict = "  varies, as expected"
        print(f"  {v:<12s} {worst[v]:.3e}{verdict}")

    print("\nPASS" if ok else "\nFAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

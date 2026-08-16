"""How much of each ALPS denominator is the fiber itself?

DTI-ALPS compares diffusivities in the plane perpendicular to the local fiber.
The denominators are meant to carry diffusion across the tract, not along it. If
the measurement axis is not perpendicular to the fiber, the denominator admits
the fiber's own lambda1, which is two to three times the perpendicular
eigenvalues, and the quantity computed stops being the quantity defined.

That claim needs no outcome variable, which is the point of measuring it. A
higher correlation with age is not evidence of validity, and in these cohorts the
corrected index often has a lower one.

The share of a diffusivity along u contributed by lambda1 is

    lambda1 (u . v1)^2 / sum_k lambda_k (u . v_k)^2

Four ways of choosing the denominator axis are compared:

  classic       scanner y in the projection region, scanner z in the association
                region. Fixed in the magnet.
  reoriented    template y and z, which is what warping the tensors into template
                space and using fixed axes there amounts to. Evaluated here as
                R'y and R'z in the native frame, identical because
                u'(RDR')u = (R'u)'D(R'u), so no warped volumes are needed.
  cross         perpendicular to the measured tract direction and to the cross
                product of the two measured directions.
  anatomical    perpendicular to the measured tract direction and to R'x.

The last two are perpendicular to the measured fiber by construction, so they
admit no lambda1 from the regional mean direction and what remains is per-voxel
dispersion about it. Any other axis in that same plane gives the same figures,
which is why the choice of perivascular axis matters far less than the choice of
frame.

Two modes:

    python reproduce/denominator_contamination.py
        A demonstration needing no data at all. Synthetic tensors with a fiber
        tilted a known amount off the scanner axis, showing what the tilt costs.

    python reproduce/denominator_contamination.py \\
        --evals evals.nii.gz --evecs evecs.nii.gz --rois rois.nii.gz \\
        [--affine subject_to_template.mat]
        The same measurement on real data. ROI label values follow the package
        convention, 1 L_SCR, 2 R_SCR, 3 L_SLF, 4 R_SLF, as written by
        `dti-alps place-rois`. Without --affine the reoriented and anatomical
        rows are skipped, since both need a registration.

Public cohorts this reproduces on: Dallas Lifespan Brain Study, OpenNeuro
ds004856, and the trigeminal neuralgia cohort, ds005713. HCP-Aging was used in
the paper under the AABC Data Use Terms, which prohibit redistribution, so no
HCP-Aging value appears anywhere in this repository.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dti_alps_refined.alps import (  # noqa: E402
    X, Y, Z, align, dyadic_principal, fractional_anisotropy, linear_coefficient,
    polar_rotation, sorted_eigen,
)

FA_MIN = 0.2
L_SCR, R_SCR, L_SLF, R_SLF = 1, 2, 3, 4


def lambda1_share(lam: np.ndarray, vec: np.ndarray, u: np.ndarray) -> float:
    """Share of the diffusivity along u contributed by lambda1.

    vec[v, i, j] is component i of eigenvector j, so the dot product contracts
    the component axis. Contracting the eigenvector axis instead returns a
    plausible number that is wrong, which is worth stating because it is not
    visible in the result.
    """
    u = np.asarray(u, float)
    u = u / max(np.linalg.norm(u), 1e-12)
    proj = np.einsum("vij,i->vj", vec, u) ** 2
    total = (lam * proj).sum(1)
    ok = total > 0
    if not ok.any():
        return float("nan")
    return float(np.mean(lam[ok, 0] * proj[ok, 0] / total[ok]))


def perpendicular(p: np.ndarray, v: np.ndarray) -> np.ndarray:
    c = np.cross(p, v)
    n = np.linalg.norm(c)
    return c / n if n > 1e-12 else Y


def demo() -> None:
    """Synthetic tensors, one fiber, tilted by a known angle off scanner z.

    A prolate tensor with the eigenvalue ratio of real white matter. The only
    thing varied is how far the fiber lies from the axis the classic index
    assumes for it.
    """
    rng = np.random.default_rng(0)
    l1, l2, l3 = 1.7e-3, 0.5e-3, 0.4e-3
    print("A single fiber tilted off scanner z, prolate tensor "
          f"({l1 / l2:.1f}:1 anisotropy), 2000 voxels with 8 deg of dispersion.\n")
    print("  tilt      classic denominator      frame locked to the fiber")
    for tilt in (0, 5, 10, 15, 20):
        th = np.radians(tilt)
        axis = np.array([0.0, np.sin(th), np.cos(th)])
        # dispersion so the region is not a single perfect direction
        v1 = axis + rng.normal(0, np.radians(8), (2000, 3))
        v1 /= np.linalg.norm(v1, axis=1, keepdims=True)
        vec = np.zeros((2000, 3, 3))
        lam = np.tile([l1, l2, l3], (2000, 1))
        for i, a in enumerate(v1):
            b = np.cross(a, X if abs(a @ X) < 0.9 else Y)
            b /= np.linalg.norm(b)
            vec[i] = np.column_stack([a, b, np.cross(a, b)])
        v_meas = align(dyadic_principal(v1, linear_coefficient(lam)), Z)
        classic = lambda1_share(lam, vec, Y)
        locked = lambda1_share(lam, vec, perpendicular(X, v_meas))
        print(f"   {tilt:2d} deg          {100 * classic:5.2f}%                  "
              f"{100 * locked:5.2f}%")
    print("\n  The classic denominator fills with fiber as the tilt grows. A frame")
    print("  built from the measured direction stays perpendicular to it, so its")
    print("  share is flat and reflects dispersion within the region alone.")


def on_data(args) -> None:
    import nibabel as nib

    lam, vec = sorted_eigen(nib.load(args.evals).get_fdata(),
                            nib.load(args.evecs).get_fdata())
    rois = nib.load(args.rois).get_fdata().astype(int)
    fa = fractional_anisotropy(nib.load(args.evals).get_fdata())
    good = fa >= args.fa_min

    R = None
    if args.affine:
        M = np.loadtxt(args.affine)
        if M.shape not in ((3, 3), (4, 4)):
            raise SystemExit(f"{args.affine} is not a 3x3 or 4x4 matrix")
        R = polar_rotation(M[:3, :3])

    rows = {}
    for hemi, scr, slf in (("L", L_SCR, L_SLF), ("R", R_SCR, R_SLF)):
        mp, ma = (rois == scr) & good, (rois == slf) & good
        if mp.sum() < 10 or ma.sum() < 10:
            continue
        vp = align(dyadic_principal(vec[mp][:, :, 0], linear_coefficient(lam[mp])), Z)
        va = align(dyadic_principal(vec[ma][:, :, 0], linear_coefficient(lam[ma])), Y)
        p_cross = np.cross(vp, va)
        p_cross /= max(np.linalg.norm(p_cross), 1e-12)

        r = {"classic": (lambda1_share(lam[mp], vec[mp], Y),
                         lambda1_share(lam[ma], vec[ma], Z)),
             "cross": (lambda1_share(lam[mp], vec[mp], perpendicular(p_cross, vp)),
                       lambda1_share(lam[ma], vec[ma], perpendicular(p_cross, va)))}
        if R is not None:
            p_anat = R.T @ X
            p_anat /= max(np.linalg.norm(p_anat), 1e-12)
            r["reoriented"] = (lambda1_share(lam[mp], vec[mp], R.T @ Y),
                               lambda1_share(lam[ma], vec[ma], R.T @ Z))
            r["anatomical"] = (lambda1_share(lam[mp], vec[mp], perpendicular(p_anat, vp)),
                               lambda1_share(lam[ma], vec[ma], perpendicular(p_anat, va)))
        rows[hemi] = r

    if not rows:
        raise SystemExit("no hemisphere had enough voxels; check the ROI labels")

    order = ["classic", "reoriented", "cross", "anatomical"]
    print(f"share of each denominator contributed by lambda1  (FA >= {args.fa_min})\n")
    print(f"  {'axis choice':14s} {'projection':>12s} {'association':>13s}")
    for k in order:
        vals = [rows[h][k] for h in rows if k in rows[h]]
        if not vals:
            continue
        pr = float(np.mean([v[0] for v in vals]))
        asc = float(np.mean([v[1] for v in vals]))
        print(f"  {k:14s} {100 * pr:11.2f}% {100 * asc:12.2f}%")
    if R is None:
        print("\n  reoriented and anatomical need --affine, the subject-to-template matrix.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--evals", help="eigenvalue volume, (x,y,z,3)")
    ap.add_argument("--evecs", help="eigenvector volume, (x,y,z,3,3)")
    ap.add_argument("--rois", help="ROI labels: 1 L_SCR, 2 R_SCR, 3 L_SLF, 4 R_SLF")
    ap.add_argument("--affine", help="subject-to-template matrix, e.g. a FLIRT .mat")
    ap.add_argument("--fa-min", type=float, default=FA_MIN)
    args = ap.parse_args()

    if not any((args.evals, args.evecs, args.rois)):
        demo()
        return
    missing = [f for f in ("evals", "evecs", "rois") if not getattr(args, f)]
    if missing:
        raise SystemExit("need --evals, --evecs and --rois together; missing "
                         + ", ".join("--" + m for m in missing))
    on_data(args)


if __name__ == "__main__":
    main()

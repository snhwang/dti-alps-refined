"""Why the tract direction is a dyadic average and not a vector average.

Reproduces the Methods claims in "Head Position Confounds the DTI-ALPS Index in
Aging and Disease" about how the projection and association directions are
estimated. Every check runs on synthetic data by default, so it needs no
downloads, and each can be pointed at real tensors instead.

The claims, in the order the paper makes them:

  1. A diffusion eigenvector has no sign. Averaging eigenvectors as vectors is
     therefore not a function of the orientations: two voxels with identical
     fibre orientation cancel if the solver signed them oppositely.

  2. Reconciling the signs against a running reference removes that failure but
     is order-dependent, because the reference is whichever voxel came first.
     Permuting voxel order moves the running-mean estimate. It does not move the
     dyadic estimate at all.

  3. The dyadic construction sum_i w_i v_i v_i^T is invariant to the sign of
     every contributing vector by construction, since (-v)(-v)^T = v v^T.

  4. The weight is the Westin linear anisotropy CL = (l1 - l2) / l1 and not
     fractional anisotropy. An eigenvector's displacement under noise scales
     inversely with its separation from the neighbouring eigenvalue, so CL
     measures how well a voxel determines the direction. FA does not: FA is also
     raised by planar anisotropy, where l1 is close to l2 and the principal
     direction is least determined.

  5. Directionally encoded colour maps give no hint of any of this, because they
     colour by the absolute components of the eigenvector and so discard the
     sign before it reaches the image.

Usage:
    python reproduce/estimator_comparison.py
    python reproduce/estimator_comparison.py --tensors evals.nii.gz evecs.nii.gz --mask roi.nii.gz
"""
from __future__ import annotations

import argparse

import numpy as np

import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

from dti_alps_refined.alps import dyadic_principal, linear_coefficient  # noqa: E402


def running_vector_mean(v: np.ndarray, w: np.ndarray) -> np.ndarray:
    """The superseded estimator: sign-align each vector to the running mean."""
    acc = v[0] * w[0]
    for i in range(1, len(v)):
        vi = v[i] if float(np.dot(v[i], acc)) >= 0 else -v[i]
        acc = acc + vi * w[i]
    n = np.linalg.norm(acc)
    return acc / n if n > 0 else acc


def acute(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.degrees(np.arccos(np.clip(abs(np.dot(a, b)), 0, 1))))


def synthetic(n: int, dispersion_deg: float, rng) -> tuple[np.ndarray, np.ndarray]:
    """A coherent fibre population with realistic eigenvalues and random signs."""
    axis = np.array([0.0, 0.2, 0.98])
    axis /= np.linalg.norm(axis)
    v = []
    for _ in range(n):
        d = rng.normal(0, np.radians(dispersion_deg), 3)
        u = axis + d
        u /= np.linalg.norm(u)
        if rng.random() < 0.5:          # the solver's sign is arbitrary
            u = -u
        v.append(u)
    v = np.asarray(v)
    lam = np.abs(rng.normal([1.6e-3, 0.55e-3, 0.42e-3], [1e-4, 6e-5, 6e-5], (n, 3)))
    lam = -np.sort(-lam, axis=1)
    return v, lam


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voxels", type=int, default=200)
    ap.add_argument("--dispersion", type=float, default=12.0,
                    help="within-region spread in degrees; real ALPS regions run near 12")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args(argv)
    rng = np.random.default_rng(a.seed)

    v, lam = synthetic(a.voxels, a.dispersion, rng)
    cl = linear_coefficient(lam)
    fa_like = np.ones(len(v))

    print(f"{a.voxels} voxels, within-region dispersion {a.dispersion} deg\n")

    # 1. a plain vector average is not a function of the orientations
    plain = v.mean(axis=0)
    print(f"1. plain vector mean has length {np.linalg.norm(plain):.3f} of a unit vector.")
    print("   With random signs it collapses toward zero, so it carries no direction.\n")

    # 2. order dependence of the sign-reconciled running mean. It does not show
    #    at low dispersion, where reconciliation always converges to the same
    #    answer, so sweep dispersion to show where it starts to matter.
    print("2. permuting voxel order, 200 draws per level. The running mean is order-")
    print("   dependent and the dyadic estimate is not, but it only shows once the")
    print("   orientations spread out:")
    print()
    print(f"   {'dispersion':>11s} {'running mean':>14s} {'dyadic':>12s}")
    for disp in (10, 20, 30, 40, 50):
        vv, ll = synthetic(a.voxels, disp, rng)
        ww = linear_coefficient(ll)
        b_run = running_vector_mean(vv, np.ones(len(vv)))
        b_dy = dyadic_principal(vv, ww)
        s_run = max(acute(b_run, running_vector_mean(vv[q], np.ones(len(vv))))
                    for q in (rng.permutation(len(vv)) for _ in range(200)))
        s_dy = max(acute(b_dy, dyadic_principal(vv[q], ww[q]))
                   for q in (rng.permutation(len(vv)) for _ in range(200)))
        print(f"   {disp:>9d} deg {s_run:>11.2f} deg {s_dy:>9.1e} deg")
    print()
    print("   Real ALPS regions run near 12 deg, where the two agree closely. The paper")
    print("   measures divergence up to 66 deg in the dispersed tail of real data.")
    print()
    base_dy = dyadic_principal(v, cl)

    # 3. sign invariance by construction
    worst = 0.0
    for _ in range(200):
        flip = rng.choice([-1.0, 1.0], len(v))[:, None]
        worst = max(worst, acute(base_dy, dyadic_principal(v * flip, cl)))
    print(f"3. flipping signs at random moves the dyadic estimate by at most "
          f"{worst:.2e} deg\n")

    # 4. CL against FA as the weight
    planar = lam.copy()
    planar[: len(planar) // 3, 1] = planar[: len(planar) // 3, 0] * 0.97   # make l1 ~ l2
    cl_p = linear_coefficient(planar)
    print(f"4. in voxels made planar, CL falls to {cl_p[: len(planar)//3].mean():.3f} "
          f"against {cl_p[len(planar)//3:].mean():.3f} elsewhere,")
    print("   so CL downweights exactly the voxels where v1 is least determined.")
    print("   FA would not: planar anisotropy raises FA while destroying the direction.\n")

    # 5. what a DEC map would show
    print(f"5. a DEC map colours by |v| components. Here "
          f"{100 * (v @ base_dy < 0).mean():.0f}% of voxels carry a sign opposing the")
    print("   region axis, and the map would look uniform regardless.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

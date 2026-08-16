"""
Orientation-aware DTI-ALPS from a diffusion tensor and labelled ROIs.

The classic index is evaluated along fixed scanner axes, which makes it change
when the head is tilted even though nothing about the brain has. Every variant
here replaces one or both of those fixed axes with a direction measured from the
data, so the index no longer depends on how the participant was lying.

Variants
  classic     Fixed scanner axes. D_x over D_y in the projection region and
              D_x over D_z in the association region. Taoka et al. 2017.
  cross       Tract directions measured from the data; the perivascular axis is
              their cross product, which is where the classic index assumes the
              perivascular spaces lie.
  measured    Tract directions measured as above, but the perivascular axis is
              estimated rather than constructed, as the pooled second
              eigenvector direction over the region.
  voxelwise   The perpendicular directions are chosen in each voxel to maximise
              and minimise the diffusivity, which makes the index exactly
              lambda2 / lambda3. No axis is estimated.
  anatomical  Tract directions measured as above, with the perivascular axis
              taken as R' x from a subject-to-template rotation, so it is the
              same axis in both hemispheres rather than perpendicular to each
              hemisphere's own pair of tracts. The only variant needing a
              registration; NaN unless template_rotation is given.
  alps_pas    Principal axis sorting (Ajouz et al. 2025), reported for
              comparison. Not rotation-invariant: it selects the eigenvector by
              its scanner-x component, so it is invariant about x alone.

All but classic and alps_pas are exactly invariant under rotation of the
tensors, which test_invariance.py checks rather than assumes.

One thing worth knowing about the voxelwise variant. Choosing the largest and
smallest perpendicular diffusivity in each voxel is a selection, so the ratio
cannot fall below one and its level sits above any fixed pair of axes. It is the
most sensitive variant we measured, but it carries no direction, so there is no
axis to report and no directional claim left to check. Prefer `measured` when
the perivascular interpretation matters, `voxelwise` when sensitivity is the
only criterion, and say which one you used.

Hemispheres come from the ROI label values, never from voxel indices or from the
sign of a world coordinate. Splitting a volume at its middle column assumes the
first voxel axis runs left to right, which is false for any image stored the
other way round, and it fails silently when it is wrong.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

X = np.array([1.0, 0.0, 0.0])
Y = np.array([0.0, 1.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])

FA_MIN = 0.2      # anisotropy floor for every region
SLAB_MM = 8.0     # half-width of the direction-estimation band, mm
MIN_MEASURE = 4   # voxels required in a measurement region
MIN_DIRECTION = 10

# Label values in the ROI image. Hemisphere is carried here so that it never has
# to be recovered from geometry downstream.
L_SCR, R_SCR, L_SLF, R_SLF = 1, 2, 3, 4
HEMIS = (("L", L_SCR, L_SLF), ("R", R_SCR, R_SLF))


# --------------------------------------------------------------------------
# tensor helpers
# --------------------------------------------------------------------------

def sorted_eigen(evals: np.ndarray, evecs: np.ndarray):
    """Eigenvalues descending, with eigenvectors reordered to match.

    evals is (..., 3); evecs is (..., 3, 3) with eigenvectors in columns.
    """
    order = np.argsort(evals, axis=-1)[..., ::-1]
    lam = np.take_along_axis(evals, order, -1)
    vec = np.take_along_axis(evecs, order[..., None, :], -1)
    return lam, vec


def fractional_anisotropy(evals: np.ndarray) -> np.ndarray:
    md = evals.mean(-1)
    num = np.sqrt(((evals - md[..., None]) ** 2).sum(-1))
    den = np.sqrt((evals ** 2).sum(-1))
    fa = np.sqrt(1.5) * np.divide(num, den, out=np.zeros_like(num), where=den != 0)
    return np.clip(fa, 0.0, 1.0)


def directional_diffusivity(evals: np.ndarray, evecs: np.ndarray, u: np.ndarray) -> float:
    """Mean over voxels of D(u) = sum_k lambda_k (v_k . u)^2."""
    if len(evals) == 0:
        return float("nan")
    dots = np.einsum("nkj,j->nk", np.transpose(evecs, (0, 2, 1)), u)
    return float(np.nanmean((evals * dots ** 2).sum(axis=1)))


def dyadic_principal(vectors: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """Mean direction of a set of sign-ambiguous unit vectors.

    Diffusion eigenvectors have no sign, so an ordinary vector mean can cancel
    two vectors that describe the same orientation. The principal eigenvector of
    the weighted outer-product sum is the Watson maximum-likelihood estimate and
    is invariant to those sign flips.
    """
    w = np.asarray(weights, float)
    total = w.sum()
    if total <= 0:
        total = 1.0
    T = np.einsum("i,ij,ik->jk", w, vectors, vectors) / total
    return np.linalg.eigh(T)[1][:, -1]


def align(v: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Point a sign-ambiguous direction the same way as a reference."""
    return v if float(np.dot(v, ref)) >= 0 else -v


def acute_angle(u: np.ndarray, v: np.ndarray) -> float:
    return float(np.degrees(np.arccos(np.clip(abs(float(np.dot(u, v))), 0, 1))))


def linear_coefficient(lam: np.ndarray) -> np.ndarray:
    """Westin CL, how well defined the principal direction is."""
    l1 = lam[..., 0]
    return np.clip(np.divide(l1 - lam[..., 1], l1, out=np.zeros_like(l1), where=l1 > 0), 0, None)


def planar_coefficient(lam: np.ndarray) -> np.ndarray:
    """Westin CP, how well defined the second eigenvector is."""
    l1 = lam[..., 0]
    return np.clip(np.divide(lam[..., 1] - lam[..., 2], l1,
                             out=np.zeros_like(l1), where=l1 > 0), 0, None)


# --------------------------------------------------------------------------
# the index
# --------------------------------------------------------------------------

def _region(lam, vec, mask):
    return {"lam": lam[mask], "vec": vec[mask],
            "v1": vec[mask][:, :, 0], "v2": vec[mask][:, :, 1]}


def _template_axis(rotation: np.ndarray) -> np.ndarray:
    """Anatomical left-right expressed in the subject's own frame.

    rotation is the rotation part of a subject-to-template affine, recovered by
    polar decomposition, so its transpose carries template x back into native
    space. Sign is fixed only for readability; the axis is unsigned.
    """
    R = np.asarray(rotation, float)
    if R.shape != (3, 3):
        raise ValueError("template_rotation must be the 3x3 rotation of the affine")
    p = R.T @ X
    n = np.linalg.norm(p)
    if n < 1e-12:
        return X
    p = p / n
    return -p if p[0] < 0 else p


def polar_rotation(linear: np.ndarray) -> np.ndarray:
    """Nearest rotation to a 3x3 linear map, by polar decomposition.

    An affine carries scale and shear as well as rotation. Only the rotation is
    wanted here, and taking it this way is what makes the recovered axis
    insensitive to how much the registration had to stretch the brain.
    """
    U, _, Vt = np.linalg.svd(np.asarray(linear, float))
    R = U @ Vt
    if np.linalg.det(R) < 0:
        U = U.copy()
        U[:, -1] *= -1
        R = U @ Vt
    return R


def _ratio(proj, assoc, p, v_proj, v_assoc) -> float:
    """The ALPS ratio along a perivascular axis p, with denominators
    perpendicular to p and to each region's own tract direction."""
    op = np.cross(p, v_proj)
    op /= max(np.linalg.norm(op), 1e-12)
    oa = np.cross(p, v_assoc)
    oa /= max(np.linalg.norm(oa), 1e-12)
    num = (directional_diffusivity(proj["lam"], proj["vec"], p)
           + directional_diffusivity(assoc["lam"], assoc["vec"], p))
    den = (directional_diffusivity(proj["lam"], proj["vec"], op)
           + directional_diffusivity(assoc["lam"], assoc["vec"], oa))
    return float(num / den)


def alps_one_hemisphere(lam, vec, fa, measure_proj, measure_assoc,
                        direction_proj, direction_assoc,
                        template_rotation: np.ndarray | None = None) -> dict | None:
    """Every variant for one hemisphere.

    measure_* select the voxels the diffusivity is measured in, conventionally
    the 5 mm spheres. direction_* select the voxels the axes are estimated from,
    conventionally the tract label restricted to the level of the spheres. They
    are separate because the two roles want different things: the measurement
    region wants comparability with prior work, the direction region wants as
    many well-oriented voxels as it can get.
    """
    if measure_proj.sum() < MIN_MEASURE or measure_assoc.sum() < MIN_MEASURE:
        return None
    if direction_proj.sum() < MIN_DIRECTION or direction_assoc.sum() < MIN_DIRECTION:
        return None

    P, A = _region(lam, vec, measure_proj), _region(lam, vec, measure_assoc)
    DP, DA = _region(lam, vec, direction_proj), _region(lam, vec, direction_assoc)

    # measured tract directions, CL-weighted so that well-defined voxels count more
    v_proj = align(dyadic_principal(DP["v1"], linear_coefficient(DP["lam"])), Z)
    v_assoc = align(dyadic_principal(DA["v1"], linear_coefficient(DA["lam"])), Y)

    p_cross = np.cross(v_proj, v_assoc)
    p_cross /= max(np.linalg.norm(p_cross), 1e-12)

    # measured perivascular axis: pooled second eigenvector, CP-weighted
    v2 = np.vstack([DP["v2"], DA["v2"]])
    w2 = np.concatenate([planar_coefficient(DP["lam"]), planar_coefficient(DA["lam"])])
    ok = w2 > 0
    if ok.sum() < 6:
        return None
    p_measured = align(dyadic_principal(v2[ok], w2[ok]), X)

    out = {
        "classic": float(
            (directional_diffusivity(P["lam"], P["vec"], X)
             + directional_diffusivity(A["lam"], A["vec"], X))
            / (directional_diffusivity(P["lam"], P["vec"], Y)
               + directional_diffusivity(A["lam"], A["vec"], Z))),
        "cross": _ratio(P, A, p_cross, v_proj, v_assoc),
        "measured": _ratio(P, A, p_measured, v_proj, v_assoc),
        # anatomical: the measured tract frame with the perivascular axis taken
        # from a registration instead of a cross product, R' x, which is the
        # same axis in both hemispheres. Reported only when a rotation is
        # supplied, since it is the one variant that needs one. Exactly
        # rotation-invariant provided the registration is recomputed for the
        # head as it lay, because then R' x rotates with the tensors.
        "anatomical": (_ratio(P, A, _template_axis(template_rotation), v_proj, v_assoc)
                       if template_rotation is not None else float("nan")),
        # voxelwise: the largest and smallest perpendicular diffusivity in each
        # voxel are lambda2 and lambda3 by definition, so no axis is estimated
        "voxelwise": float((P["lam"][:, 1].mean() + A["lam"][:, 1].mean())
                           / (P["lam"][:, 2].mean() + A["lam"][:, 2].mean())),
        "alps_pas": _alps_pas(P, A),
        "theta_proj_to_z": acute_angle(v_proj, Z),
        "theta_assoc_to_y": acute_angle(v_assoc, Y),
        "theta_pvs_to_x": acute_angle(p_cross, X),
        "theta_measured_to_x": acute_angle(p_measured, X),
        "theta_interfiber": acute_angle(v_proj, v_assoc),
        "n_measure_proj": int(measure_proj.sum()),
        "n_measure_assoc": int(measure_assoc.sum()),
        "n_direction_proj": int(direction_proj.sum()),
        "n_direction_assoc": int(direction_assoc.sum()),
    }
    return out


def _alps_pas(proj, assoc) -> float:
    """Principal axis sorting: in each voxel take the eigenvector most aligned
    with scanner x as the perivascular direction, and the remaining two as the
    denominators. Included for comparison; it is invariant about x only."""
    def split(reg, tract_ref):
        dots = np.abs(np.einsum("nji,j->ni", reg["vec"], X))
        ix = np.argmax(dots, axis=1)
        n = len(ix)
        num = reg["lam"][np.arange(n), ix]
        rest = np.array([[j for j in range(3) if j != i] for i in ix])
        other = reg["lam"][np.arange(n)[:, None], rest]
        # the denominator is the one of the remaining two that is less aligned
        # with the region's own tract direction
        tdots = np.abs(np.einsum("nji,j->ni", reg["vec"], tract_ref))
        keep = tdots[np.arange(n)[:, None], rest]
        pick = np.argmin(keep, axis=1)
        den = other[np.arange(n), pick]
        return float(np.nanmean(num)), float(np.nanmean(den))

    np_, dp = split(proj, Z)
    na, da = split(assoc, Y)
    return float((np_ + na) / (dp + da))


def alps_from_volumes(evals: np.ndarray, evecs: np.ndarray, affine: np.ndarray,
                      measure_labels: np.ndarray,
                      direction_labels: np.ndarray | None = None,
                      fa: np.ndarray | None = None,
                      fa_min: float = FA_MIN,
                      slab_mm: float = SLAB_MM,
                      template_rotation: np.ndarray | None = None) -> dict:
    """Every variant, per hemisphere and averaged.

    measure_labels uses 1=L_SCR, 2=R_SCR, 3=L_SLF, 4=R_SLF. direction_labels
    uses the same convention; if omitted the measurement regions are used for
    the direction estimate as well, which is the conventional configuration and
    the noisier one.
    """
    lam, vec = sorted_eigen(evals, evecs)
    if fa is None:
        fa = fractional_anisotropy(evals)
    good = fa >= fa_min

    if direction_labels is None:
        direction_labels = measure_labels
        band = np.ones(measure_labels.shape, bool)
    else:
        # restrict the direction region to the axial level of the spheres, since
        # both tract labels extend well above and below it
        ii, jj, kk = np.indices(measure_labels.shape)
        zw = (affine[2, 0] * ii + affine[2, 1] * jj + affine[2, 2] * kk + affine[2, 3])
        inside = measure_labels > 0
        z0 = float(np.median(zw[inside])) if inside.any() else 0.0
        band = np.abs(zw - z0) <= slab_mm

    per_hemi = {}
    for name, scr, slf in HEMIS:
        r = alps_one_hemisphere(
            lam, vec, fa,
            (measure_labels == scr) & good,
            (measure_labels == slf) & good,
            (direction_labels == scr) & good & band,
            (direction_labels == slf) & good & band,
            template_rotation=template_rotation)
        if r is not None:
            per_hemi[name] = r

    if not per_hemi:
        raise ValueError("no hemisphere had enough voxels; check the ROI labels "
                         "and the FA threshold")

    keys = [k for k in next(iter(per_hemi.values())) if not k.startswith("n_")]
    combined = {k: float(np.mean([h[k] for h in per_hemi.values()])) for k in keys}
    return {"combined": combined, "hemispheres": per_hemi}


# --------------------------------------------------------------------------
# command line
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    import nibabel as nib

    ap = argparse.ArgumentParser(
        description="Orientation-aware DTI-ALPS from a tensor and labelled ROIs.")
    ap.add_argument("--evals", required=True, help="eigenvalues, (x,y,z,3)")
    ap.add_argument("--evecs", required=True, help="eigenvectors, (x,y,z,3,3), columns")
    ap.add_argument("--rois", required=True,
                    help="measurement ROIs: 1=L_SCR 2=R_SCR 3=L_SLF 4=R_SLF")
    ap.add_argument("--direction-rois", default=None,
                    help="optional larger regions for the axis estimate, same labels")
    ap.add_argument("--fa", default=None, help="optional FA map; computed if omitted")
    ap.add_argument("--fa-min", type=float, default=FA_MIN)
    ap.add_argument("--slab-mm", type=float, default=SLAB_MM)
    ap.add_argument("--json", default=None, help="write results here instead of stdout")
    args = ap.parse_args(argv)

    evals = nib.load(args.evals).get_fdata()
    evec_img = nib.load(args.evecs)
    evecs = evec_img.get_fdata()
    if evecs.ndim == 4 and evecs.shape[-1] == 9:
        evecs = evecs.reshape(evecs.shape[:3] + (3, 3))
    roi_img = nib.load(args.rois)
    rois = np.rint(roi_img.get_fdata()).astype(int)
    drois = (np.rint(nib.load(args.direction_rois).get_fdata()).astype(int)
             if args.direction_rois else None)
    fa = nib.load(args.fa).get_fdata() if args.fa else None

    present = sorted(set(np.unique(rois)) - {0})
    if not present:
        print("error: the ROI image is empty", file=sys.stderr)
        return 2
    if max(present) > 4:
        print(f"error: ROI labels {present} exceed the expected 1..4. This tool "
              f"takes hemisphere from the label value: 1=L_SCR 2=R_SCR 3=L_SLF "
              f"4=R_SLF.", file=sys.stderr)
        return 2

    res = alps_from_volumes(evals, evecs, roi_img.affine, rois, drois,
                            fa=fa, fa_min=args.fa_min, slab_mm=args.slab_mm)
    text = json.dumps(res, indent=2)
    if args.json:
        Path(args.json).write_text(text, encoding="utf-8")
        print(f"wrote {args.json}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

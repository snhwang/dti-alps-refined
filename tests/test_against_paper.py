"""
Does the shipped implementation reproduce the values in the paper?

The manuscript's numbers come from a separate cohort pipeline that carries
hemisphere in the geometry and merges the two tract regions into one label
image. This tool carries hemisphere in the label value instead. That is a better
design, but it is a different one, so the two have to be checked against each
other rather than assumed equal.

Builds four-label ROI images from the cohort pipeline's inputs, runs the shipped
code, and compares against the stored per-session values.

Not part of the public test suite: it needs the processed image tree.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dti_alps_refined.alps import alps_from_volumes, fractional_anisotropy

OUT = Path("Q:/dti_output")
PAPER = Path(r"C:\Users\Scott\Documents\Work\paper-DTI-correction\revision")
SHELL = "_b1500"
N = 6

# cohort pipeline label ids -> ours
JHU = {26: 1, 25: 2, 42: 3, 41: 4}     # L_SCR, R_SCR, L_SLF, R_SLF


def main() -> int:
    import nibabel as nib

    stored = pd.read_csv(PAPER / "measured_pvs_axis_hcpa_b1500_all.csv")
    src = pd.read_csv(Path(r"C:\Users\Scott\Documents\Work\diffusion\HCP")
                      / "hcpa_alps_spheres_5mm.csv")
    src = src[src.status == "ok"]

    rows, checked = [], 0
    for r in src.itertuples():
        sd = OUT / r.DTI_Session_ID / "processed"
        lab_p = sd / "atlas" / "jhu_labels_registered.nii.gz"
        sph_p = sd / "atlas" / "sphere_roi" / "sphere_roi_combined.nii.gz"
        ev_p = sd / f"tensor_eigenvalues{SHELL}.nii.gz"
        vc_p = sd / f"tensor_eigenvectors{SHELL}.nii.gz"
        if not all(p.exists() for p in (lab_p, sph_p, ev_p, vc_p)):
            continue
        want = stored[(stored.Subject_ID == r.Subject_ID) & (stored.Visit == r.Visit)]
        if want.empty:
            continue

        limg = nib.load(str(lab_p))
        lab = np.rint(limg.get_fdata()).astype(int)
        sph = np.rint(nib.load(str(sph_p)).get_fdata()).astype(int)
        evals = nib.load(str(ev_p)).get_fdata()
        evecs = nib.load(str(vc_p)).get_fdata()

        # The cohort pipeline's sphere image is 1=SCR, 2=SLF with hemispheres
        # merged, so the side has to be recovered from world x here. NIfTI world
        # coordinates are RAS+, so x < 0 is anatomically left. This is exactly
        # the step the shipped tool removes.
        ii, jj, kk = np.indices(lab.shape)
        A = limg.affine
        xw = A[0, 0] * ii + A[0, 1] * jj + A[0, 2] * kk + A[0, 3]
        left = xw < 0

        rois = np.zeros_like(lab)
        rois[(sph == 1) & left] = 1
        rois[(sph == 1) & ~left] = 2
        rois[(sph == 2) & left] = 3
        rois[(sph == 2) & ~left] = 4

        drois = np.zeros_like(lab)
        for src_id, dst_id in JHU.items():
            drois[lab == src_id] = dst_id

        try:
            got = alps_from_volumes(evals, evecs, limg.affine, rois, drois)
        except ValueError:
            continue

        w = want.iloc[0]
        rows.append({
            "session": r.DTI_Session_ID,
            "classic_paper": float(w.classic), "classic_ours": got["combined"]["classic"],
            "cross_paper": float(w.cross), "cross_ours": got["combined"]["cross"],
            "measured_paper": float(w.v2_slab), "measured_ours": got["combined"]["measured"],
            "voxelwise_paper": float(w.pv_perp), "voxelwise_ours": got["combined"]["voxelwise"],
        })
        checked += 1
        if checked >= N:
            break

    if not rows:
        print("no sessions available")
        return 1

    d = pd.DataFrame(rows)
    print(f"{len(d)} sessions\n")
    ok = True
    for name in ("classic", "cross", "measured", "voxelwise"):
        diff = (d[f"{name}_paper"] - d[f"{name}_ours"]).abs()
        rel = diff / d[f"{name}_paper"].abs()
        flag = "" if rel.max() < 1e-9 else ("  <-- differs" if rel.max() > 1e-3 else "  (rounding)")
        print(f"  {name:<10s} max |relative difference| {rel.max():.3e}{flag}")
        ok &= rel.max() < 1e-3
    print("\nMATCHES THE PAPER" if ok else "\nDOES NOT MATCH")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

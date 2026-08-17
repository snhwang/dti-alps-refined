"""Compare this package's variants against LD-ALPS on your own data.

LD-ALPS (Burles et al., NeuroSci 2025) is the closest competing method and the
only one with published evidence of clinical sensitivity beyond mean
diffusivity. This runs it beside the variants here so the comparison is against
their implementation rather than against a description of it.

Their code is not redistributed with this repository. Download it from
https://fordburles.com/ld-alps.html (MIT) and pass the path with --ld-alps.
It needs numpy, scipy, scikit-learn and nibabel.

What differs between the methods, since it is easy to miss. LD-ALPS estimates a
direction in every voxel after rejecting outliers by density clustering, then
obtains the apparent diffusion coefficient by interpolating the measured signal
across the acquired gradient directions. It never uses the diffusion tensor. The
variants here read diffusivity from the fitted tensor. That is a different
measurement, not a different parameterisation, and it is why LD-ALPS needs the
4D data while these need only the eigen-decomposition.

Their loader expects a directory per subject, named with a common prefix, each
holding:

    eddy_corrected_data.nii.gz                4D DWI after eddy correction
    eddy_corrected_data.eddy_rotated_bvecs    (3, K) rotated gradient table
    bvals                                     (K,)
    dti_V1.nii.gz                             principal eigenvector volume
    nativeALPSrois.nii.gz                     labels 1..4 in their order,
                                              R_Assoc, R_Proj, L_Assoc, L_Proj

Note that label order is theirs and differs from the convention used by
`dti-alps place-rois`, which writes 1 L_SCR, 2 R_SCR, 3 L_SLF, 4 R_SLF. This
script rewrites the labels rather than leaving the mapping to the reader, since
getting it wrong silently swaps projection for association.

    python reproduce/compare_ld_alps.py \\
        --evals evals.nii.gz --evecs evecs.nii.gz --rois rois.nii.gz \\
        --dwi eddy_corrected.nii.gz --bvecs rotated.bvec --bvals dwi.bval \\
        --ld-alps /path/to/ld-alps.py

One caveat on multi-shell data. Their implementation pools every non-zero
b-value when forming ADCs, which suits a single-shell acquisition. Give it one
shell at a time if your data has more than one, and say which in any report.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dti_alps_refined.alps import alps_from_volumes, polar_rotation  # noqa: E402

# ours -> theirs
LABEL_MAP = {1: 4, 2: 2, 3: 3, 4: 1}   # L_SCR->L_Proj, R_SCR->R_Proj, L_SLF->L_Assoc, R_SLF->R_Assoc


def stage(args, dest: Path) -> None:
    """Lay one subject out the way their loader expects."""
    import nibabel as nib

    dest.mkdir(parents=True, exist_ok=True)
    for src, name in ((args.dwi, "eddy_corrected_data.nii.gz"),
                      (args.bvecs, "eddy_corrected_data.eddy_rotated_bvecs"),
                      (args.bvals, "bvals")):
        shutil.copyfile(src, dest / name)

    ev = nib.load(args.evecs)
    v1 = np.asanyarray(ev.dataobj)[..., 0]
    nib.save(nib.Nifti1Image(np.ascontiguousarray(v1, np.float32), ev.affine),
             str(dest / "dti_V1.nii.gz"))

    roi_img = nib.load(args.rois)
    ours = np.asanyarray(roi_img.dataobj).astype(int)
    theirs = np.zeros_like(ours, dtype=np.uint8)
    for a, b in LABEL_MAP.items():
        theirs[ours == a] = b
    nib.save(nib.Nifti1Image(theirs, roi_img.affine), str(dest / "nativeALPSrois.nii.gz"))


def main() -> None:
    import nibabel as nib

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--evals", required=True)
    ap.add_argument("--evecs", required=True)
    ap.add_argument("--rois", required=True, help="1 L_SCR, 2 R_SCR, 3 L_SLF, 4 R_SLF")
    ap.add_argument("--dwi", required=True, help="4D eddy-corrected DWI")
    ap.add_argument("--bvecs", required=True, help="rotated bvecs, (3,K)")
    ap.add_argument("--bvals", required=True)
    ap.add_argument("--ld-alps", required=True, help="path to their ld-alps.py")
    ap.add_argument("--affine", help="subject-to-template matrix, enables the anatomical axis")
    args = ap.parse_args()

    ld = Path(args.ld_alps)
    if not ld.exists():
        raise SystemExit(f"not found: {ld}\nDownload it from https://fordburles.com/ld-alps.html")

    ev_img = nib.load(args.evals)
    R = None
    if args.affine:
        M = np.loadtxt(args.affine)
        R = polar_rotation(M[:3, :3])
    ours = alps_from_volumes(
        np.asanyarray(ev_img.dataobj), np.asanyarray(nib.load(args.evecs).dataobj),
        ev_img.affine, np.asanyarray(nib.load(args.rois).dataobj).astype(int),
        template_rotation=R)

    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        stage(args, base / "alps_subject")
        out = base / "ld_alps.csv"
        r = subprocess.run([sys.executable, str(ld), str(base),
                            "--subject-prefix", "alps_", "--out", str(out)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-2000:])
            print(r.stderr[-2000:])
            raise SystemExit(f"LD-ALPS exited {r.returncode}")
        import csv
        with open(out) as fh:
            row = next(iter(csv.DictReader(fh)))

    print("index values for this subject\n")
    for k in ("classic", "cross", "measured", "voxelwise", "anatomical"):
        v = ours.get(k)
        if v is None or (isinstance(v, float) and np.isnan(v)):
            note = "  (needs --affine)" if k == "anatomical" else ""
            print(f"  {k:12s}      --{note}")
        else:
            print(f"  {k:12s} {float(v):7.4f}")
    print(f"  {'LD-ALPS':12s} {float(row['ALPS_overall']):7.4f}")
    print("\n  LD-ALPS derives its diffusivity from the measured signal rather than")
    print("  from the tensor, so agreement between it and the others is a check on")
    print("  the frame rather than on the model.")


if __name__ == "__main__":
    main()

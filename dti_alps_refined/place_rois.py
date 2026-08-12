"""
Automated ALPS region placement, so nobody has to draw the regions by hand.

Manual placement is the main reason ALPS values are not comparable between
studies. Two raters following the same written protocol produce regions that
disagree enough to move the index by more than the disease effects the
literature reports, and a rater who redraws the same brain at a later visit
disagrees with themselves. Placing the regions from an atlas removes the
operator entirely, which is what made it possible to run this analysis on
thousands of sessions rather than dozens.

What happens here
  1. FLIRT then FNIRT register the subject's FA map to FMRIB58_FA_1mm.
  2. invwarp inverts that, giving template to subject.
  3. The four measurement spheres, defined once in template space and shipped
     with this package, are warped into the subject's native space with
     nearest-neighbour interpolation, keeping the hemisphere in the label value.
  4. The JHU tract labels are warped the same way, giving the larger regions
     used for the direction estimate.

The spheres in `rois/` are the ones used in the accompanying paper. Using them
rather than your own is what makes your values comparable to published ones.

Requires FSL on PATH. Registration takes a few minutes per session, almost all
of it in FNIRT, and the result is cached so a rerun is free.

    python -m dti_alps_refined.place_rois --fa fa.nii.gz --out rois/

Note on hemispheres. The output labels are 1=L_SCR, 2=R_SCR, 3=L_SLF, 4=R_SLF.
Hemisphere is carried in the label rather than recovered later by splitting the
volume down the middle, because that split assumes the first voxel axis runs
left to right and is wrong, silently, for any image stored the other way.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROI_DIR = HERE / "rois"

# template-space sphere files -> output label
SPHERES = {"L_SCR": 1, "R_SCR": 2, "L_SLF": 3, "R_SLF": 4}
# JHU ICBM-DTI-81 label ids -> the same output labels
JHU_LABELS = {26: 1, 25: 2, 42: 3, 41: 4}


def _fsl_dir() -> Path:
    d = os.environ.get("FSLDIR")
    if not d:
        raise RuntimeError(
            "FSLDIR is not set. This step needs FSL for registration. "
            "Install FSL and set FSLDIR, or supply ROIs yourself and pass them "
            "to alps.py directly.")
    return Path(d)


def _to_fsl_path(p: Path | str) -> str:
    """FSL under WSL needs POSIX paths; on Linux and macOS this is a no-op."""
    p = str(p).replace("\\", "/")
    if len(p) > 1 and p[1] == ":":
        p = f"/mnt/{p[0].lower()}{p[2:]}"
    return p


def _run(cmd: str, timeout: int = 1800) -> None:
    exe = shutil.which("fnirt") or shutil.which("flirt")
    wrapped = cmd if exe else f'wsl -e bash -lc "{cmd}"'
    r = subprocess.run(wrapped, shell=True, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"FSL command failed:\n  {cmd}\n{r.stderr.strip()[:500]}")


def register_to_template(fa: Path, work: Path, force: bool = False) -> Path:
    """Return the template-to-subject warp field, computing it if needed."""
    work.mkdir(parents=True, exist_ok=True)
    inverse = work / "atlas_to_subject_warp.nii.gz"
    if inverse.exists() and not force:
        return inverse

    fsl = _fsl_dir()
    ref = fsl / "data" / "standard" / "FMRIB58_FA_1mm.nii.gz"
    if not ref.exists():
        raise RuntimeError(f"registration target not found: {ref}")

    affine = work / "subject_to_template.mat"
    coef = work / "subject_to_template_warp_coef.nii.gz"

    _run(f"flirt -in {_to_fsl_path(fa)} -ref {_to_fsl_path(ref)} "
         f"-omat {_to_fsl_path(affine)} -dof 12 -cost corratio "
         f"-searchrx -90 90 -searchry -90 90 -searchrz -90 90")
    _run(f"fnirt --in={_to_fsl_path(fa)} --ref={_to_fsl_path(ref)} "
         f"--aff={_to_fsl_path(affine)} --cout={_to_fsl_path(coef)} "
         f"--config=FA_2_FMRIB58_1mm", timeout=1800)
    _run(f"invwarp --warp={_to_fsl_path(coef)} --ref={_to_fsl_path(fa)} "
         f"--out={_to_fsl_path(inverse)}")
    return inverse


def _warp(src: Path, ref: Path, warp: Path, dst: Path) -> np.ndarray:
    import nibabel as nib
    if not dst.exists():
        _run(f"applywarp --in={_to_fsl_path(src)} --ref={_to_fsl_path(ref)} "
             f"--warp={_to_fsl_path(warp)} --out={_to_fsl_path(dst)} --interp=nn")
    return nib.load(str(dst)).get_fdata()


def place(fa: Path, out_dir: Path, force: bool = False) -> tuple[Path, Path]:
    """Write the measurement and direction ROI images for one session."""
    import nibabel as nib

    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "registration"
    warp = register_to_template(fa, work, force=force)

    fa_img = nib.load(str(fa))
    shape = fa_img.shape[:3]

    measure = np.zeros(shape, np.uint8)
    for name, label in SPHERES.items():
        src = ROI_DIR / f"{name}.nii.gz"
        if not src.exists():
            raise RuntimeError(f"missing shipped ROI: {src}")
        measure[_warp(src, fa, warp, work / f"{name}_native.nii.gz") > 0.5] = label

    fsl = _fsl_dir()
    jhu = fsl / "data" / "atlases" / "JHU" / "JHU-ICBM-labels-1mm.nii.gz"
    direction = np.zeros(shape, np.uint8)
    if jhu.exists():
        native = np.rint(_warp(jhu, fa, warp, work / "jhu_labels_native.nii.gz"))
        for src_id, label in JHU_LABELS.items():
            direction[native == src_id] = label
    else:
        print(f"note: {jhu.name} not found, so the direction regions fall back to "
              f"the spheres. Expect a noisier axis estimate.", file=sys.stderr)
        direction = measure.copy()

    m_path, d_path = out_dir / "alps_rois.nii.gz", out_dir / "alps_direction_rois.nii.gz"
    nib.save(nib.Nifti1Image(measure, fa_img.affine), str(m_path))
    nib.save(nib.Nifti1Image(direction, fa_img.affine), str(d_path))

    counts = {n: int((measure == l).sum()) for n, l in SPHERES.items()}
    print(f"measurement voxels: {counts}")
    if min(counts.values()) < 4:
        print("warning: at least one region is nearly empty, which usually means "
              "the registration failed. Check alps_rois.nii.gz against the FA map "
              "before trusting the result.", file=sys.stderr)
    return m_path, d_path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Place ALPS regions from the atlas.")
    ap.add_argument("--fa", required=True, help="subject FA map")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--force", action="store_true", help="recompute the registration")
    args = ap.parse_args(argv)
    m, d = place(Path(args.fa), Path(args.out), force=args.force)
    print(f"wrote {m}\nwrote {d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

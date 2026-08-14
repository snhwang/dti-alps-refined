"""Recover head pose two ways, one of which the brain cannot influence.

The paper's principal finding is that head position covaries with age, so a
fixed-axis index converts posture into an apparent aging effect. That rests on
measuring head pose, and there are two independent ways to do it.

  affine        Polar-decompose a subject-to-template affine into its nearest
                rotation and read pitch, roll and yaw as intrinsic Euler angles.
                Scale and shear go into the discarded stretch factor. This needs
                a registration, and it is fitted to brain shape, so a reader can
                reasonably ask whether age-related atrophy shifts the optimal
                rotation without the head having moved.

  prescription  Read the slice normal straight out of the image header. The
                third column of the NIfTI affine is the slice normal in scanner
                coordinates, so its tilt out of the axial plane is the angulation
                the operator dialled in before any data were collected. Nothing
                about the brain can change it, which is what makes it a control
                on the first measure.

In the DLBS cohort the two agree at r = -0.223 and each tracks age at about the
same magnitude, -0.342 for the prescription and +0.340 for the affine. The
opposite sign is interpretable: the operator angulated the slab further for
older participants, which is what one does when the head is pitched back, so the
affine measure sees only the residual after that compensation and understates
the true tilt. Their difference correlates with age at +0.428.

Both cohorts used in the paper are subject to data use terms. DLBS is public on
OpenNeuro as ds004856 and the trigeminal cohort as ds005713, so both of these
measurements can be reproduced from public data. HCP-Aging cannot be
redistributed, and no identifier from it appears in this repository.

Usage:
    python reproduce/head_pose.py --prescription sub-01_dwi.nii.gz
    python reproduce/head_pose.py --affine subject_to_mni.mat
    python reproduce/head_pose.py --prescription-dir /path/to/bids --pattern "**/*dwi.nii.gz"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def nearest_rotation(m: np.ndarray) -> np.ndarray:
    """Rotation part of a linear map, with the stretch discarded."""
    u, _, vt = np.linalg.svd(m)
    r = u @ vt
    if np.linalg.det(r) < 0:
        u = u.copy()
        u[:, -1] *= -1
        r = u @ vt
    return r


def euler_xyz(r: np.ndarray) -> tuple[float, float, float]:
    """Intrinsic x-y-z Euler angles in degrees: pitch, roll, yaw."""
    pitch = np.degrees(np.arctan2(-r[2, 1], r[2, 2]))
    roll = np.degrees(np.arcsin(np.clip(r[2, 0], -1, 1)))
    yaw = np.degrees(np.arctan2(-r[1, 0], r[0, 0]))
    return float(pitch), float(roll), float(yaw)


def pose_from_affine(path: Path) -> dict:
    a = np.loadtxt(path)
    if a.shape != (4, 4):
        raise SystemExit(f"{path}: expected a 4x4 FLIRT matrix, got {a.shape}")
    r = nearest_rotation(a[:3, :3])
    pitch, roll, yaw = euler_xyz(r)
    total = float(np.degrees(np.arccos(np.clip((np.trace(r) - 1) / 2, -1, 1))))
    return dict(source=path.name, pitch=pitch, roll=roll, yaw=yaw, total=total)


def prescription_from_header(path: Path) -> dict:
    import nibabel as nib

    img = nib.load(str(path))
    a = np.asarray(img.affine)[:3, :3]
    # Third column is the slice normal. Its stored direction is arbitrary, so fix
    # the hemisphere before reading an angle off it.
    n = a[:, 2] / np.linalg.norm(a[:, 2])
    if n[2] < 0:
        n = -n
    return dict(source=path.name,
                tilt=float(np.degrees(np.arccos(np.clip(n[2], -1, 1)))),
                pitch=float(np.degrees(np.arctan2(n[1], n[2]))),
                roll=float(np.degrees(np.arctan2(n[0], n[2]))))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--affine", type=Path, help="a 4x4 subject-to-template FLIRT matrix")
    ap.add_argument("--prescription", type=Path, help="a raw NIfTI whose header carries the geometry")
    ap.add_argument("--prescription-dir", type=Path, help="walk a tree and summarise")
    ap.add_argument("--pattern", default="**/*dwi.nii.gz")
    a = ap.parse_args(argv)

    if not any((a.affine, a.prescription, a.prescription_dir)):
        ap.print_help()
        return 1

    if a.affine:
        p = pose_from_affine(a.affine)
        print(f"affine pose      pitch {p['pitch']:+7.2f}  roll {p['roll']:+7.2f}  "
              f"yaw {p['yaw']:+7.2f}  total {p['total']:6.2f} deg")

    if a.prescription:
        p = prescription_from_header(a.prescription)
        print(f"slice prescription  angulation {p['tilt']:6.2f} deg  "
              f"(sagittal {p['pitch']:+6.2f}, coronal {p['roll']:+6.2f})")

    if a.prescription_dir:
        rows = []
        for f in sorted(a.prescription_dir.glob(a.pattern)):
            try:
                rows.append(prescription_from_header(f))
            except Exception:
                continue
        if not rows:
            print(f"no readable images under {a.prescription_dir} matching {a.pattern}")
            return 1
        tilt = np.array([r["tilt"] for r in rows])
        pitch = np.array([r["pitch"] for r in rows])
        print(f"{len(rows)} images")
        print(f"  angulation from axial  median {np.median(tilt):5.2f} deg  "
              f"IQR [{np.percentile(tilt, 25):.2f}, {np.percentile(tilt, 75):.2f}]  "
              f"max {tilt.max():.2f}")
        print(f"  sagittal component     median {np.median(pitch):+5.2f} deg  "
              f"SD {pitch.std():.2f}")
        print()
        print("  Pair these with participant age to reproduce the control in the paper.")
        print("  In DLBS the sagittal component tracks age at r = -0.342.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

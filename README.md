# dti-alps-refined

Orientation-aware DTI-ALPS index from preprocessed DWI, with a FastAPI
backend and a Vite/React/TypeScript frontend.

The package computes several flavors of the ALPS ratio from a diffusion
tensor and two ROI masks (SCR/projection and SLF/association):

| Method      | Axes used in the ratio                                          | Rotation-invariant |
| ----------- | --------------------------------------------------------------- | ------------------ |
| Classic     | Fixed scanner axes (x, y, z). Taoka et al. 2017.                | no                 |
| Refined     | Subject-specific axes; PVS axis is the cross product of them.   | yes                |
| Refined+    | Same, with PVS axis additionally refined per-voxel.             | yes                |
| Measured    | PVS axis estimated from the data as the pooled 2nd eigenvector. | yes                |
| Voxelwise   | Perpendicular directions taken per voxel, so exactly λ2 / λ3.   | yes                |
| ALPS-PAS    | Principal axis sorting (Ajouz et al. 2025).                     | about x only       |

The last column is the point of the package, and it is checked rather
than claimed — see [Rotation invariance](#rotation-invariance) below.

There are two ways in. The **command line** (`alps.py`, `place_rois.py`)
is batch-friendly, has no Node dependency, and is what you want for a
cohort. The **web UI** is for inspecting one session interactively and
drawing regions by hand.

## Command line

```bash
# 1. place the regions automatically from the atlas (needs FSL)
python -m dti_alps_refined.place_rois --fa fa.nii.gz --out session/

# 2. compute every variant
python -m dti_alps_refined.alps \
    --evals tensor_eigenvalues.nii.gz \
    --evecs tensor_eigenvectors.nii.gz \
    --rois session/alps_rois.nii.gz \
    --direction-rois session/alps_direction_rois.nii.gz
```

Step 1 is optional; supply your own ROI image if you prefer, labelled
`1 = L_SCR, 2 = R_SCR, 3 = L_SLF, 4 = R_SLF`. Output is JSON, per
hemisphere and averaged, with each variant and the scanner-to-anatomy
deviation angles.

Hemisphere comes from the **label value**, never from splitting the
volume down the middle. That split assumes the first voxel axis runs
left to right, which is false for any image stored the other way round,
and it fails silently when it is wrong.

### The shipped regions

`dti_alps_refined/rois/` holds the four measurement spheres in template
space, 5 mm radius, centred 26 mm lateral for the projection region and
38 mm for the association region. These are the regions used in the
accompanying paper. Absolute ALPS values are strongly protocol-specific,
so using these rather than your own is what makes your numbers
comparable to published ones.

### Rotation invariance

```bash
python tests/test_invariance.py
```

Builds synthetic tensors, rotates them by 5–30° about each axis, and
checks that the corrected variants do not move. Needs no data and no
FSL, and takes a few seconds. Expected: classic drifts by about a third
over that range, ALPS-PAS by a few percent, and Refined, Measured and
Voxelwise are constant to machine precision (10⁻¹⁶).

## What this is *not*

* Not a full DWI preprocessing pipeline. Eddy-current / motion
  correction (FSL `eddy`, see [Optional: FSL](#optional-fsl-for-eddy-correction)),
  MP-PCA denoising (DIPY), and post-eddy bvec rotation are wired in and
  run when you ask for them. Susceptibility / EPI distortion correction
  (e.g. `topup`) is **not** included — supply distortion-corrected DWI
  if you need it.
* Not a segmentation tool. Automatic ROI placement is available again
  (`place_rois.py`, atlas registration through FSL FNIRT), and it is what
  the accompanying paper used for every session. Hand-drawn regions are
  still accepted by the web UI. Check the placement before trusting it:
  `place_rois.py` warns when a region comes back nearly empty, which is
  the usual sign that registration failed.

## Install

The package is not yet on PyPI. Clone the repo and install in editable
mode into a fresh Python ≥3.10 environment.

```bash
git clone https://github.com/snhwang/dti-alps-refined.git
cd dti-alps-refined

# Backend Python deps (uv recommended):
uv venv
source .venv/bin/activate                       # Windows: .venv\Scripts\activate
uv pip install -e .

# Frontend (Node ≥18):
cd web_ui
npm install
npm run build                                   # produces web_ui/dist/
cd ..
```

The FastAPI server serves the built React bundle from `web_ui/dist/`
relative to the working directory, so always launch the server from the
project root.

## Run

```bash
dti-alps                                        # listens on $PORT (default 8080)
# or:
python -m dti_alps_refined.server
```

Open `http://localhost:8080/` and follow the steps below. Each upload
creates a **session** on disk under `dti_output/`; sessions persist
until you delete them from the Session Manager.

### 1. Upload

On the upload form, supply:

* **DWI** (`*.nii.gz`) — the 4-D diffusion volume.
* **bval** and **bvec** — must already match the DWI in scanner space
  (rotated upstream if you reoriented the DWI).
* **Anatomical** (optional) — FLAIR or T1, used only as a context image
  in the viewer; not part of the ALPS computation.
* **JSON sidecar** (optional) — if present, phase-encoding direction
  and total readout time are read from it and **override** anything you
  typed in the form. Skip the sidecar if you want to enter those values
  by hand.

Under **Processing options**:

* **Run eddy correction** — needs FSL on `PATH`
  (see [Optional: FSL](#optional-fsl-for-eddy-correction)). With FSL
  missing, the backend skips eddy with a warning and continues on the
  raw DWI rather than failing. Sub-fields appear when enabled:
  Repol, phase encode direction, total readout time. Eddy also
  rotates the bvecs to match its motion-corrected output; downstream
  steps pick up the rotated bvecs automatically.
* **MP-PCA denoising patch radius** — DIPY's `mppca`. `0` (default)
  disables denoising; `1`–`5` set the patch radius (`3` is the
  standard MP-PCA setting, `5` is more aggressive).
* **Skull stripping** — Median Otsu (DIPY, default), FSL BET, or
  *None* if your DWI is already skull-stripped.
* **Standard DTI maps** (on by default) — fits the tensor on upload so
  the viewer can open without an extra step.

Click **Upload & Process**. Status shows a generic "Processing…"
message; the backend writes `fa.nii.gz`, `evals.nii.gz`, `evecs.nii.gz`,
and a colour-FA image into the session directory. Expect a few minutes
on a typical single-shell DWI, longer with eddy enabled.

### 2. Open the viewer

When processing finishes, click **Launch DTI-ALPS Tool** in the results
panel (or the matching button in the Session Manager). The viewer loads
colour-FA on axial slices.

### 3. Pick a slice and draw ROIs

* Use the slice slider or numeric input to land on an axial slice
  through the lateral ventricles where the SCR (medial blue) and SLF
  (lateral green) bundles are clearly separated on the colour-FA map.
* Set **ROI type** to **SCR (Proj)** (blue) and draw one ROI in each
  hemisphere on the projection-fibre bundle. Switch to **SLF (Assoc)**
  (green) and draw two more on the association-fibre bundle.
* Drawing tools: freehand by default; toggle **Shape mode** for
  rectangle / ellipse ROIs (movable, resizable, rotatable).
* The footer shows live voxel counts split by hemisphere
  (`Proj L: … R: …`, `Assoc L: … R: …`). Left/right come from the world
  x coordinate in the image affine, so they are correct whichever way
  the volume is stored; there is no automatic mirroring.

### 4. Compute

Adjust **FA threshold** (default 0.2) if needed and pick a **b-value
shell** for multi-shell data. Click **Compute ALPS** — the button is
disabled until both an SCR and an SLF ROI exist. The result panel
reports Classic / Refined / Refined+ / ALPS-PAS, optionally split into
left and right hemisphere values.

### 5. Export

* **Download results** (in the viewer) writes the session's full
  results JSON.
* **Export ALPS table** (in the Session Manager) produces a CSV/TSV
  across all sessions, with optional BIDS `participants.tsv`
  demographics joined in.

## Tips and gotchas

* **NIfTI orientation and bvec rotation.** Eddy rotates the bvecs to
  match its motion-corrected output, but the backend does **not**
  rotate bvecs to compensate for an upstream reorientation of the
  DWI. If you reoriented the volume yourself without rotating the
  bvecs to match, the principal-direction maps will be wrong and the
  ALPS index will be meaningless.
* **ROI placement is not validated.** If your "SCR" ROI lands in the
  cingulum, the math still runs and produces a number. Sanity-check
  against the colour-FA legend (blue = projection, green = association).
* **Multi-shell data.** Pick a single shell from the b-value dropdown
  in the viewer; mixing shells in one fit will distort the tensor.

## Frontend dev server

When iterating on UI code:

```bash
cd web_ui
npm run dev
```

Vite serves on `http://localhost:5173` and proxies API calls to the
FastAPI server at `http://localhost:8080` (see `vite.config.ts`).

## Optional dependencies

* **SimpleITK** — install via `uv pip install -e .[sitk]` if you need
  the FLAIR/atlas registration code paths inside the backend. Not
  required for plain tensor fitting + ALPS computation.

## Optional: FSL for eddy correction

[FSL](https://fsl.fmrib.ox.ac.uk/) (FMRIB Software Library) is a suite
of neuroimaging tools from the University of Oxford. This project only
uses one of them: `eddy`, which corrects eddy-current distortions and
subject motion in diffusion-weighted images. If your DWI was already
eddy-corrected upstream you do **not** need FSL — leave the **Eddy
correction** checkbox off and skip this section.

Eddy current and motion correction are run through FSL's `eddy`
binary. If FSL isn't on the server's `PATH`, the backend logs
`FSL: not available` on startup; sessions that request eddy will
**skip** the eddy step with a warning and run the tensor fit on the
raw DWI rather than failing outright. With FSL present, eddy runs
normally; with the checkbox cleared, eddy is skipped silently.

> ⚠️ **Binary name caveat.** The current code calls `eddy_cuda11.0`
> directly ([server.py:7107](dti_alps_refined/server.py#L7107)). On a CPU-only FSL
> install you'll have `eddy` and `eddy_openmp` instead, and the call
> will fail. Either symlink one of those to `eddy_cuda11.0` on your
> `PATH`, or use the official FSL installer which ships a working
> `eddy_cuda*.0` matching your CUDA version.

#### Linux (Ubuntu / Debian)

```bash
sudo apt-get update
sudo apt-get install fsl
echo 'export FSLDIR=/usr/share/fsl' >> ~/.bashrc
echo 'export PATH=$FSLDIR/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

CentOS / RHEL: `sudo yum install epel-release && sudo yum install fsl`,
then export the same env vars.

For a more recent build (and a working `eddy_cuda*.0`), use the
official installer instead:

```bash
curl -L https://fsl.fmrib.ox.ac.uk/fsldownloads/fslinstaller.py -o fslinstaller.py
python3 fslinstaller.py
```

#### Windows

Use **WSL2** (Ubuntu) and run the Linux instructions inside it. FSL
does not run natively on Windows.

```powershell
wsl --install
```

Then in the Ubuntu shell, follow the Linux block above.

#### macOS

```bash
# Homebrew
brew install fsl
echo 'export FSLDIR=/usr/local/fsl' >> ~/.zshrc
echo 'export PATH=$FSLDIR/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
```

Or use the official `fslinstaller.py` (recommended if you want the
GPU-accelerated `eddy_cuda*.0`).

#### Verifying

After installing, restart the FastAPI server and look at the boot log:

```
FSL: available
```

means the eddy path is unlocked. `FSL: not available` means the binary
isn't on `PATH` from the shell that launched the server.

## Citation

If you use this software, please cite the paper (TBD) and the upstream
methods:

* Taoka T, et al. *Magn Reson Med Sci* 2024;23:268–290 — DTI-ALPS.
* DIPY — Garyfallidis et al. *Front. Neuroinformatics* 2014;8:8.
* NiBabel — https://nipy.org/nibabel/

## License

MIT.

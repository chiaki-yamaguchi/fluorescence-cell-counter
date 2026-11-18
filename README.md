# Fluorescence Cell Counter

A browser-based tool for viewing fluorescence microscopy images, marking cell bodies manually, and exporting channel counts. Images are processed in the browser. [Open the hosted app](https://fluorescence-cell-counter-rgc.chiaki-vv.chatgpt.site).

## Run locally

From this directory, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/ in a browser. The app uses plain HTML, CSS, and JavaScript with no build step.

## Manual counting workflow

1. Select **Manual counting**. Open the red (RBPMS) and green (EGFP) images of the same retinal field. The app overlays images by pixel coordinates. Use pre-registered images of the same dimensions.
2. Inspect each fluorescence channel and use the overlay to compare the same locations. Click individual cell bodies to record markers based on visual assessment. Adjust display zoom, brightness, or contrast to inspect the images.
3. Red-view clicks add red markers. With both images loaded at the same size, a click in the green view also records the cell in red. An available red marker within 4 pixels is reused when present. In the overlay view, clicking an unmarked location adds a shared marker to both channels. Channel assignment follows these controls and does not independently verify fluorescence in either channel.
4. Click an existing marker to select it. Use **Delete selected marker**, the Delete key, or **Undo** to correct a count. Select **Export CSV** to save the two channel totals and their ratio for the field.
5. For each retina, sum the EGFP-positive and RBPMS-positive cell-body counts across the sampled peripheral fields separately. Compute 100 × total EGFP count / total RBPMS count. Use a double-positive numerator only when the observer verified both signals in the same cell bodies.

The optional automatic candidate detector uses local contrast and shape. The manual workflow records observer-selected markers. This release documents and reproduces the workflow, and includes English interface labels.

## Suggested manuscript wording

> RBPMS-positive and EGFP-positive cell bodies were identified by visual inspection of paired fluorescence images of the same peripheral retinal fields. Individual cell bodies were marked on the images and tallied using Fluorescence Cell Counter, a browser-based tool for manual annotation and counting. For each retina, counts were summed across the sampled fields. Transduction efficiency was estimated as the total EGFP-positive cell-body count divided by the total RBPMS-positive cell-body count, expressed as a percentage.

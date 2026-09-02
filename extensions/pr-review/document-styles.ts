export const META_REVIEW_DOCUMENT_CSS = String.raw`
.reviewBody { flex:1; min-height:0; overflow:auto; padding:18px 22px 80px; background:#f8f7f4; transition:padding-right .2s ease; }
.reviewDocument { max-width:1680px; margin:0 auto; }
.reviewLayout { display:grid; grid-template-columns:minmax(0,1fr) 292px; grid-template-areas:"main rail"; gap:24px; align-items:start; }
.reviewMain { grid-area:main; min-width:0; }
.reviewReadingRail { grid-area:rail; position:sticky; top:18px; max-height:calc(100vh - 132px); overflow:auto; padding-left:18px; border-left:1px solid #d5d1ca; }
#workspace.rightDrawerOpen #reviewSurface .reviewBody { padding-right:calc(var(--drawer-width) + 18px); }
#workspace.rightDrawerOpen #reviewSurface .reviewDocument { max-width:none; margin-left:0; margin-right:0; }
#workspace.rightDrawerOpen #reviewSurface .reviewLayout { grid-template-columns:minmax(0,1fr); grid-template-areas:"main"; }
#workspace.rightDrawerOpen #reviewSurface .reviewReadingRail { display:none!important; }
.reviewSectionLabel { margin:0 0 8px; color:#b63b2f; font:850 9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.14em; text-transform:uppercase; }
.reviewOverview,.reviewRelationshipSection,.reviewFindingsSection { margin-bottom:22px; border:1px solid #c9c5bd; background:#fff; }
.reviewOverviewLead { display:grid; grid-template-columns:minmax(210px,.46fr) minmax(0,1.54fr); gap:34px; padding:22px 24px; }
.reviewOverview h2,.reviewRelationshipSection h2,.reviewFindingsSection h2,.reviewFilesHeader h2 { margin:0; font-size:22px; letter-spacing:-.025em; }
.reviewOverviewTitle { margin:0; color:#30353a; font-size:17px; font-weight:850; line-height:1.55; }
.reviewOverviewHint { margin:10px 0 0; color:#817b74; font-size:10px; line-height:1.55; }
.reviewOverviewGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1px; border-top:1px solid #d8d4cc; background:#d8d4cc; }
.reviewOverviewItem { padding:16px 18px; background:#fbfaf7; }
.reviewOverviewItem b { display:block; margin-bottom:6px; color:#157a6e; font-size:10px; }
.reviewOverviewItem p { margin:0; color:#4e555d; font-size:12px; line-height:1.65; }
.reviewOverviewMetrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1px; border-top:1px solid #d8d4cc; background:#d8d4cc; }
.reviewMetric { padding:13px 15px; background:#fff; }
.reviewMetric b { display:block; font-size:19px; }
.reviewMetric span { color:#716b64; font-size:10px; }
.reviewRelationshipHeader,.reviewFindingsHeader { padding:20px 22px 16px; }
.reviewRelationshipHeader p,.reviewFindingsHeader p { max-width:900px; margin:8px 0 0; color:#5f666d; font-size:12px; line-height:1.65; }
.reviewRelationshipDiagram { min-height:360px; overflow:auto; padding:24px; border-top:1px solid #e2ded7; background:#fff; }
.reviewRelationshipDiagram svg { display:block; width:max(100%,1040px); max-width:none; max-height:none; height:auto; margin:auto; }
.reviewRelationshipDiagram svg text { font-size:13px!important; }
.reviewRelationshipEmpty { padding:28px 22px; border-top:1px solid #e2ded7; color:#817b74; font-size:11px; }
.reviewRelationshipGuide { display:grid; grid-template-columns:minmax(250px,.72fr) minmax(0,1.28fr); gap:18px; padding:18px 22px 22px; border-top:1px solid #e2ded7; background:#fbfaf7; }
.reviewRelationshipLegend { padding:14px 15px; border-left:3px solid #157a6e; background:#f1f7f5; }
.reviewRelationshipLegend b { display:block; margin-bottom:7px; font-size:12px; }
.reviewRelationshipLegend ol { margin:0; padding-left:18px; color:#4e555d; font-size:11px; line-height:1.65; }
.reviewRelationList { display:grid; gap:7px; }
.reviewRelationRow { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:8px; align-items:center; padding:10px 11px; border:1px solid #e0dcd5; background:#fff; }
.reviewRelationRow button { min-width:0; padding:0; border:0; background:transparent; color:#315d57; font-size:10px; font-weight:800; text-align:left; overflow-wrap:anywhere; }
.reviewRelationRow button:last-of-type { text-align:right; }
.reviewRelationRow > span { color:#9a948c; }
.reviewRelationRow p { grid-column:1/4; margin:1px 0 0; color:#666d73; font-size:10px; line-height:1.5; }
.reviewFindingList { display:grid; gap:1px; border-top:1px solid #e2ded7; background:#e2ded7; }
.reviewFindingIndex { display:grid; grid-template-columns:90px minmax(0,1fr) auto; gap:14px; align-items:start; padding:16px 18px; background:#fff; cursor:pointer; }
.reviewFindingIndex:hover { background:#fff7f4; }
.reviewFindingIndex > b { color:#b63b2f; font:850 9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; text-transform:uppercase; }
.reviewFindingIndex h3 { margin:0; color:#272b2f; font-size:15px; line-height:1.45; }
.reviewFindingIndex p { margin:6px 0 0; color:#555d65; font-size:11px; line-height:1.6; }
.reviewFindingIndex small { display:block; margin-top:6px; color:#817b74; overflow-wrap:anywhere; }
.reviewFindingIndex button { align-self:center; white-space:nowrap; }
.reviewReadingRailHeader { display:flex; justify-content:space-between; gap:12px; align-items:baseline; padding:3px 0 13px; border-bottom:2px solid #355f9a; }
.reviewReadingRailHeader h3 { margin:0; font-size:13px; }
.reviewReadingRailHeader span { color:#817b74; font-size:10px; }
.reviewReadingOrder { display:grid; gap:0; }
.reviewReadingStep { display:grid; grid-template-columns:28px minmax(0,1fr); gap:9px; padding:12px 0; border:0; border-bottom:1px solid #e2ded7; border-radius:0; background:transparent; text-align:left; }
.reviewReadingStep:hover,.reviewReadingStep.active { background:#f2f8f6; }
.reviewReadingStep b { color:#157a6e; font:850 9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; }
.reviewReadingStep span { min-width:0; color:#4e555d; font-size:10px; overflow-wrap:anywhere; }
.reviewReadingStep small { display:block; margin-top:3px; color:#817b74; line-height:1.45; }
.reviewReadingRailFooter { padding:12px 0; color:#817b74; font:9px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
.reviewFiles { margin-bottom:22px; }
.reviewFilesHeader { padding:20px 0 14px; }
.reviewFile { margin:0; border-top:1px solid #bdb9b1; background:#fff; }
.reviewFile:last-child { border-bottom:1px solid #bdb9b1; }
.reviewFile > summary { display:block; padding:0; cursor:pointer; list-style:none; }
.reviewFile > summary::-webkit-details-marker { display:none; }
.reviewFileSummaryRow { display:grid; grid-template-columns:38px minmax(240px,.9fr) minmax(260px,1.1fr) auto 18px; gap:13px; align-items:center; padding:16px 0; }
.reviewFileNumber { color:#b63b2f; font:850 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
.reviewFilePath { font-size:15px; font-weight:850; letter-spacing:-.015em; overflow-wrap:anywhere; }
.reviewFileSummary { color:#555d65; font-size:11px; line-height:1.55; }
.reviewFileCount { color:#858b91; font:800 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:nowrap; }
.reviewFileToggle::before { content:"+"; color:#858b91; font:18px/1 ui-monospace,SFMono-Regular,Menlo,monospace; }
.reviewFile[open] .reviewFileToggle::before { content:"−"; color:#2d2925; }
.reviewFileIntro { display:grid; gap:5px; margin:0 0 15px 51px; padding:12px 14px; border:1px solid #e4e0d9; background:#fbfaf7; }
.reviewFileIntro p { margin:0; font-size:11px; line-height:1.55; }
.reviewFileBody { padding:0 0 24px 51px; }
.reviewDiff { overflow:auto; border:1px solid #ddd9d1; background:#f5f5f2; }
@media(max-width:1180px){.reviewLayout{grid-template-columns:1fr;grid-template-areas:"rail" "main"}.reviewReadingRail{position:static;max-height:none;padding:14px 16px;border:1px solid #d5d1ca;background:#fff}.reviewReadingOrder{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 14px}.reviewRelationshipGuide{grid-template-columns:1fr}}
@media(max-width:900px){.reviewOverviewLead,.reviewOverviewGrid{grid-template-columns:1fr}.reviewOverviewMetrics{grid-template-columns:1fr 1fr}.reviewFindingIndex{grid-template-columns:72px minmax(0,1fr)}.reviewFindingIndex button{grid-column:2;justify-self:start}.reviewFileSummaryRow{grid-template-columns:30px minmax(0,1fr) auto 16px}.reviewFileSummary{grid-column:2/5}.reviewFileCount{grid-column:3}.reviewFileIntro,.reviewFileBody{margin-left:0;padding-left:12px}.reviewFileBody{padding-right:0}}
.reviewLine { display:grid; grid-template-columns:48px 48px minmax(680px,1fr); min-height:23px; border-top:1px solid rgba(221,217,209,.45); font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; cursor:pointer; }
.reviewLine:hover { outline:2px solid rgba(21,122,110,.18); outline-offset:-2px; }
.reviewLine.selected,.reviewExplanation.selected,.reviewFinding.selected,.reviewFileIntro.selected,.reviewOverview.selected,.reviewRelationshipSection.selected,.reviewFindingIndex.selected,.reviewSemanticUnitHeader.selected,.reviewDeclarationUnitHeader.selected { outline:3px solid rgba(21,122,110,.34); outline-offset:-3px; }
.reviewSemanticUnitHeader { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:10px; align-items:center; padding:8px 10px; border-top:2px solid #91c9c1; border-bottom:1px solid #b9ded8; background:#eaf5f2; cursor:pointer; }
.reviewSemanticUnitHeader b { color:#157a6e; font:850 9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; text-transform:uppercase; }
.reviewSemanticUnitHeader span { min-width:0; color:#284b46; font-size:11px; font-weight:800; overflow-wrap:anywhere; }
.reviewSemanticUnitHeader small { color:#657b77; font-size:9px; white-space:nowrap; }
.reviewLine.reviewSemanticUnit { border-left:3px solid #91c9c1; }
.reviewLine.reviewSemanticStart { border-top-color:#91c9c1; }
.reviewLine.reviewSemanticEnd { border-bottom:2px solid #91c9c1; }
.reviewLine.reviewSemanticUnit.selected { outline:none; box-shadow:inset 4px 0 #157a6e; }
.reviewDeclarationUnitHeader { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:10px; align-items:center; padding:9px 10px; border-top:2px solid #4f8fbe; border-bottom:1px solid #b8d3e7; background:#edf5fb; cursor:pointer; }
.reviewDeclarationUnitHeader b { color:#27678f; font:850 9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; text-transform:uppercase; }
.reviewDeclarationUnitHeader span { min-width:0; color:#294a61; font-size:11px; font-weight:850; overflow-wrap:anywhere; }
.reviewDeclarationUnitHeader small { color:#617887; font-size:9px; white-space:nowrap; }
.reviewLine.reviewDeclarationUnit { border-left:3px solid #76a9cd; }
.reviewLine.reviewDeclarationStart { border-top-color:#76a9cd; }
.reviewLine.reviewDeclarationEnd { border-bottom:2px solid #76a9cd; }
.reviewLine.reviewDeclarationUnit.selected { outline:none; box-shadow:inset 4px 0 #27678f; }
.reviewDeclarationPreviewHost:empty { display:none; }
.reviewDeclarationPreview { margin:0 0 14px; border:3px solid #27678f; background:#fff; box-shadow:0 8px 24px rgba(39,103,143,.12); }
.reviewDeclarationPreviewHeader { display:grid; gap:10px; padding:13px 15px; border-bottom:1px solid #b8d3e7; background:#edf5fb; }
.reviewDeclarationPreviewTitle { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px 14px; align-items:center; }
.reviewDeclarationPreviewTitle b { color:#244b65; font-size:13px; }
.reviewDeclarationBreadcrumb,.reviewDeclarationControls,.reviewDeclarationChildren { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.reviewDeclarationBreadcrumb button,.reviewDeclarationControls button,.reviewDeclarationChildren button { font-size:9px; }
.reviewDeclarationBreadcrumb span { color:#8a9aa5; }
.reviewDeclarationChildren { padding:10px 15px; border-top:1px solid #d9e6ef; background:#f8fbfd; }
.reviewDeclarationChildren > b { color:#617887; font-size:9px; text-transform:uppercase; }
.reviewDeclarationSource { overflow:auto; max-height:560px; background:#f8fafb; }
.reviewDeclarationSourceLine { display:grid; grid-template-columns:58px minmax(720px,1fr); min-height:23px; border-top:1px solid rgba(190,205,215,.38); font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
.reviewDeclarationSourceLine.changed { background:#e7f3ed; }
.reviewDeclarationSourceLine span:first-child { padding:2px 9px; color:#8b9ba5; text-align:right; border-right:1px solid #d5e0e7; user-select:none; }
.reviewDeclarationSourceLine code { padding:2px 10px; white-space:pre; }
.reviewSemanticUnitHeader,.reviewDeclarationUnitHeader { display:none; }
.reviewLine.reviewSemanticUnit,.reviewLine.reviewDeclarationUnit { border-left:0; }
.reviewLine.reviewSemanticStart,.reviewLine.reviewDeclarationStart { border-top-color:rgba(221,217,209,.45); }
.reviewLine.reviewSemanticEnd,.reviewLine.reviewDeclarationEnd { border-bottom:0; }
.reviewLine.selected,.reviewLine.reviewSemanticUnit.selected,.reviewLine.reviewDeclarationUnit.selected { position:relative; outline:none; box-shadow:inset 5px 0 #157a6e; }
.reviewLine.selected::after { content:"┃"; position:absolute; left:3px; top:2px; color:#157a6e; font-weight:900; }
.reviewLine.selected.selectionStart { border-top:2px solid #157a6e; }
.reviewLine.selected.selectionStart::after { content:"▶"; left:1px; }
.reviewLine.selected.selectionEnd { border-bottom:2px solid #157a6e; }
.reviewLine.selected.selectionEnd:not(.selectionStart)::after { content:"┗"; left:2px; }
.reviewLine.addition.selected { background:#dff0e6; }
.reviewLine.deletion.selected { background:#f5dfdf; }
.reviewLine.context.selected { background:#e8f3f1; }
.reviewDeclarationPreview { margin:8px 0 12px; border:2px solid #157a6e; box-shadow:0 7px 20px rgba(21,122,110,.12); }
.reviewDeclarationPreviewHeader { background:#eef7f5; }
.reviewSelectionBadge { display:inline-flex; align-items:center; gap:5px; padding:3px 7px; border-radius:999px; background:#157a6e; color:white; font-size:9px; font-weight:900; }
.reviewDeclarationSourceDisclosure > summary { padding:9px 15px; border-top:1px solid #cfe2de; background:#f7fbfa; color:#35665f; cursor:pointer; font-size:10px; font-weight:850; }
.reviewMeaningsSection { margin:0 0 28px; border:1px solid #d5d1ca; background:#fff; }
.reviewMeaningsHeader { padding:18px 20px 12px; border-bottom:1px solid #e1ddd6; }
.reviewMeaningsHeader h2 { margin:0 0 6px; font-size:18px; }
.reviewMeaningList { display:grid; gap:10px; padding:14px; }
.reviewMeaning { display:grid; gap:10px; padding:14px 16px; border:1px solid #d9d5ce; border-left:4px solid #7660a9; background:#fbfaf7; cursor:pointer; }
.reviewMeaning:hover,.reviewMeaning.selected { background:#f2eef8; border-color:#aa9cc5; }
.reviewMeaningHeader { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; align-items:center; }
.reviewMeaningHeader h3 { margin:0; font-size:14px; }
.reviewMeaningTransition { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:10px; align-items:stretch; }
.reviewMeaningContract { padding:10px 12px; border:1px solid #e0dcd5; background:#fff; font-size:11px; line-height:1.55; }
.reviewMeaningContract b { display:block; margin-bottom:4px; color:#675f57; font-size:9px; text-transform:uppercase; }
.reviewMeaningArrow { align-self:center; color:#7660a9; font-size:20px; font-weight:900; }
.reviewMeaningBasis { display:flex; flex-wrap:wrap; gap:5px; }
.reviewMeaningBasis span { padding:3px 6px; border-radius:999px; background:#eee9f6; color:#655681; font-size:9px; }
.reviewMeaningVisual { padding:12px; border:1px solid #d8d2e4; background:#fff; }
.reviewMeaningVisualHeader { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px; }
.reviewMeaningVisualHeader b { font-size:12px; }
.reviewMeaningVisualHeaderActions { display:flex; flex-wrap:wrap; justify-content:flex-end; align-items:center; gap:7px; }
.reviewMeaningVisualExpand { padding:5px 8px; border-color:#7660a9; color:#5b458e; background:#f7f3fb; font-size:9px; font-weight:850; white-space:nowrap; }
.reviewMeaningLegend { display:flex; flex-wrap:wrap; gap:5px; }
.reviewMeaningLegend span { display:inline-flex; align-items:center; gap:4px; padding:3px 6px; border:1px solid currentColor; border-radius:999px; font-size:8px; font-weight:800; }
.reviewMeaningLegend span::before { content:""; width:7px; height:7px; border-radius:2px; background:currentColor; }
.reviewMeaningLegend .removed { color:#b73535; border-style:dashed; }
.reviewMeaningLegend .new { color:#238b50; }
.reviewMeaningLegend .moved { color:#7142c4; }
.reviewMeaningLegend .preserved { color:#356fb8; }
.reviewMeaningLegend .guard { color:#b36a00; }
.reviewMeaningLegend .context { color:#6f757c; }
.reviewMeaningDiagramViewport { max-height:320px; min-height:170px; overflow:auto; padding:6px; border:1px solid #ebe7e0; background:#fffdf8; }
.reviewMeaningDiagramViewport .noteDiagramCanvas { min-width:680px; min-height:150px; }
.reviewMeaningDiagramViewport svg { width:100%; max-height:300px; }
.reviewMeaningReadingHint { margin:8px 0 0; padding:7px 9px; border-left:3px solid #7660a9; background:#f7f3fb; color:#5c5269; font-size:9px; line-height:1.5; }
body.reviewMeaningVisualOverlayOpen { overflow:hidden; }
.reviewMeaningVisualOverlay { position:fixed; inset:0; z-index:220; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(24,21,31,.72); backdrop-filter:blur(4px); }
.reviewMeaningVisualOverlay[hidden] { display:none; }
.reviewMeaningVisualOverlayDialog { width:min(1440px,calc(100vw - 32px)); height:calc(100vh - 32px); min-height:520px; display:grid; grid-template-rows:auto auto minmax(0,1fr); overflow:hidden; border:1px solid #cfc5dd; border-radius:16px; background:#fffdf8; box-shadow:0 24px 80px rgba(15,12,24,.38); }
.reviewMeaningVisualOverlayHeader { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:12px 14px; border-bottom:1px solid #ded7e8; background:#f7f3fb; }
.reviewMeaningVisualOverlayHeader h2 { margin:2px 0 0; font-size:17px; }
.reviewMeaningVisualOverlayHeader p { margin:0; color:#7660a9; font-size:9px; font-weight:850; text-transform:uppercase; letter-spacing:.08em; }
.reviewMeaningVisualOverlayControls { display:flex; align-items:center; justify-content:flex-end; gap:6px; flex-wrap:wrap; }
.reviewMeaningVisualOverlayControls button { min-width:34px; padding:6px 9px; font-weight:850; }
.reviewMeaningVisualZoomValue { min-width:48px; text-align:center; color:#4e4559; font-size:10px; font-weight:850; }
.reviewMeaningVisualOverlayMeta { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:9px 14px; border-bottom:1px solid #ebe6ef; background:#fff; }
.reviewMeaningVisualOverlayHint { margin:0; color:#5c5269; font-size:10px; line-height:1.5; }
.reviewMeaningVisualOverlayCanvas { min-height:0; overflow:auto; overscroll-behavior:contain; padding:18px; background:#fffdf8; }
.reviewMeaningVisualOverlayStage { width:100%; transform-origin:top left; transition:width .14s ease; }
.reviewMeaningVisualOverlayStage svg { display:block; width:100% !important; height:auto !important; max-width:none !important; max-height:none !important; margin:0 auto; }
@media(max-width:900px){.reviewMeaningTransition{grid-template-columns:1fr}.reviewMeaningArrow{transform:rotate(90deg);justify-self:center}.reviewMeaningDiagramViewport{max-height:280px}.reviewMeaningVisualOverlay{padding:8px}.reviewMeaningVisualOverlayDialog{width:calc(100vw - 16px);height:calc(100vh - 16px);min-height:0}.reviewMeaningVisualOverlayHeader,.reviewMeaningVisualOverlayMeta{align-items:flex-start;flex-direction:column}.reviewMeaningVisualOverlayControls{width:100%;justify-content:flex-start}}

.reviewLine.addition { background:#edf6ef; }
.reviewLine.deletion { background:#fbeeee; }
.reviewLine.hunk-header,.reviewLine.file-header,.reviewLine.old-file,.reviewLine.new-file { background:#eceae4; color:#675f57; }
.reviewLineNo { padding:2px 7px; text-align:right; color:#aaa39a; border-right:1px solid #dedad2; user-select:none; }
.reviewLineCode { padding:2px 10px; white-space:pre; }
.reviewExplanation,.reviewFinding { margin:12px 16px 16px; padding:15px 16px; border-radius:12px; background:#fffdf8; box-shadow:0 7px 22px rgba(58,48,38,.08); cursor:pointer; }
.reviewFileIntro { cursor:pointer; }
.reviewFileIntro:hover,.reviewExplanation:hover,.reviewFinding:hover { background:#f6fbf9; }
.reviewExplanation { border-left:4px solid #157a6e; }
.reviewFinding { border-left:4px solid #b63b2f; }
.reviewExplanation h4,.reviewFinding h4 { margin:0 0 9px; font-size:14px; }
.reviewExplanation dl { display:grid; grid-template-columns:130px minmax(0,1fr); gap:5px 10px; margin:0; font-size:11px; }
.reviewExplanation dt { color:#6f675e; font-weight:850; }
.reviewExplanation dd { margin:0; }
.reviewFindingDraft { margin:9px 0; padding:11px 13px; border:1px solid #dfd9cf; background:#faf8f3; font-weight:700; white-space:pre-wrap; }
.reviewActions { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.reviewActions button { font-size:9px; }
.reviewStatus { padding:3px 7px; border-radius:999px; background:#e8f1ee; color:#16665d; font-size:9px; font-weight:850; }
.reviewExplanationRange { display:inline-flex; align-items:center; margin:0 0 10px; padding:4px 8px; border:1px solid #d8e7e2; border-radius:999px; background:#f2f8f6; color:#35665f; font-size:10px; font-weight:800; }
.reviewContextCard { margin-bottom:0; }
.reviewContextCard .detailLead { margin-top:8px; }
.reviewSelectionMeta { margin-top:7px; color:var(--muted); font-size:10px; line-height:1.5; word-break:break-word; }
.reviewQuestionEvidence { margin-top:7px; padding-top:6px; border-top:1px solid #d8cfc1; }
.reviewRefreshMenu { position:relative; }
.reviewRefreshMenu > summary { display:flex; align-items:center; justify-content:center; min-width:34px; min-height:34px; list-style:none; cursor:pointer; user-select:none; color:#403a34; background:#fffaf2; border:1px solid #cfc4b5; border-radius:10px; font-weight:850; }
.reviewRefreshMenu > summary::-webkit-details-marker { display:none; }
.reviewRefreshMenu > summary:hover { border-color:#9f9282; background:#f8f1e6; }
.reviewRefreshMenu[open] > summary { border-color:var(--accent); background:#dbeee8; color:#145e56; }
.reviewRefreshMenu > div { position:absolute; right:0; z-index:5; min-width:180px; margin-top:5px; padding:7px; border:1px solid #cfc6ba; border-radius:10px; background:#fffdf8; box-shadow:0 10px 30px rgba(50,42,34,.18); }
.reviewRefreshMenu button { width:100%; }
.reviewRefreshMenu button + button { margin-top:5px; }
.reviewExportStatus { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.reviewExportStatus a { color:var(--accent); }
.reviewStaticQuestions { max-width:calc(100% - 316px); margin:28px 316px 0 0; border:1px solid #d5d1ca; background:#fff; }
.reviewStaticQuestionsHeader { padding:18px 20px 12px; border-bottom:1px solid #e1ddd6; }
.reviewStaticQuestionsHeader h2 { margin:0 0 6px; font-size:18px; }
.reviewStaticQuestionList { display:grid; gap:1px; background:#e2ded7; }
.reviewStaticQuestion { padding:16px 18px; background:#fff; }
.reviewStaticQuestion h3 { margin:0; font-size:14px; line-height:1.5; }
.reviewStaticQuestionMeta { display:flex; flex-wrap:wrap; gap:5px 12px; margin-top:5px; color:#817b74; font-size:9px; }
.reviewStaticAnswer { margin-top:11px; padding:12px 14px; border-left:4px solid #7660a9; background:#f7f3fb; white-space:pre-wrap; line-height:1.65; }
.reviewStaticQuestionEvidence,.reviewStaticQuestionChange { display:grid; gap:4px; margin-top:10px; color:#6d6660; font-size:10px; }
.reviewStaticQuestionChange { padding:10px 12px; border-left:3px solid #157a6e; background:#f2f8f6; }
.reviewStaticQuestionChange b,.reviewStaticQuestionChange span { display:block; }
@media(max-width:1180px){.reviewStaticQuestions{max-width:none;margin-right:0}}
`;

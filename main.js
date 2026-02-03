// main.js
import { AVDParser } from './avd_parser.js';
import { AVDRenderer } from './renderer.js';

const fileInput = document.getElementById('avd-file');
const canvas = document.getElementById('preview-canvas');
const fpsInput = document.getElementById('fps');
const scaleInput = document.getElementById('scale');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnStepBack = document.getElementById('btn-step-back');
const btnStepForward = document.getElementById('btn-step-forward');
const btnRepeat = document.getElementById('btn-repeat');
const btnExport = document.getElementById('btn-export');
const btnExportMp4 = document.getElementById('btn-export-mp4');
const btnSaveXml = document.getElementById('btn-save-xml');
const btnOpenXml = document.getElementById('btn-open-xml');
const btnSearch = document.getElementById('btn-search');
const btnReplace = document.getElementById('btn-replace');
const btnGithub = document.getElementById('btn-github');
const timeline = document.getElementById('timeline');
const timeDisplay = document.getElementById('time-display');
const exportStatus = document.getElementById('export-status');
const editorTextarea = document.getElementById('xml-editor');
const lintStatus = document.getElementById('lint-status');
const btnFormatXml = document.getElementById('btn-format-xml');
const speedToggle = document.getElementById('speed-toggle');
const previewViewport = document.getElementById('preview-viewport');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');
const zoomLevelLabel = document.getElementById('zoom-level');
const previewTopControls = document.querySelector('.preview-top-controls');
const btnToggleTopPanel = document.getElementById('btn-toggle-top-panel');
const btnShowTopPanel = document.getElementById('btn-show-top-panel');
const panelResizer = document.getElementById('panel-resizer');
const editorPanel = document.querySelector('.editor-panel');
const previewPanel = document.querySelector('.preview-panel');
const workspace = document.querySelector('.workspace');
const menuSections = Array.from(document.querySelectorAll('.menu-section'));
const menuButtons = menuSections.map((section) => section.querySelector('.menu-title'));

const parser = new AVDParser();
const renderer = new AVDRenderer(canvas);

let avdData = null;
let isPlaying = false;
let pausedTime = 0; // Time within the animation [0, duration]
let animationId = null;
let currentDuration = 0;
let editorView = null;
let liveUpdateTimer = null;
let playbackRate = 1;
let lastFrameTimestamp = 0;
let frameAccumulator = 0;
const speedSteps = [0.5, 1, 2];
let isRepeat = true;
const viewState = {
  zoom: 1,
  panX: 0,
  panY: 0
};
let isPanning = false;
let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
let currentFileName = 'vector.xml';

// Init
canvas.width = 400;
canvas.height = 400;

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  currentFileName = file.name || currentFileName;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const xml = evt.target.result;
      setEditorContent(xml);
      applyXmlToPreview(xml);
    } catch (err) {
      console.error(err);
      alert("Error parsing AVD: " + err.message);
    }
  };
  reader.readAsText(file);
});

function applyXmlToPreview(xml) {
  try {
    avdData = parser.parse(xml);
    console.log("Parsed AVD:", avdData);

    // Set initial duration from AVD
    currentDuration = avdData.duration;

    renderer.load(avdData);

    updateCanvasSize();
    renderer.render(0);

    // UI Update
    updateDurationUI();
    timeline.value = 0;
    updateTimeDisplay(0);

    // Reset playback
    pause();
    pausedTime = 0;

    if (lintStatus) {
      lintStatus.textContent = "AVD loaded";
    }
  } catch (err) {
    console.error(err);
    if (lintStatus) {
      lintStatus.textContent = `AVD error: ${err.message}`;
    }
    alert("Error parsing AVD: " + err.message);
  }
}

function updateCanvasSize() {
  if (!avdData) return;
  const scale = parseFloat(scaleInput.value);
  const w = avdData.vector.viewportWidth * scale; // Use viewport size for aspect ratio
  const h = avdData.vector.viewportHeight * scale;

  // We resize the canvas element itself (not just CSS)
  canvas.width = w;
  canvas.height = h;
  renderer.setScale(scale);

  // Re-render current frame
  renderer.render(pausedTime);
  centerCanvas();
  applyViewTransform();
}

scaleInput.addEventListener('input', updateCanvasSize);

function updateDurationUI() {
  timeline.max = currentDuration;
}

function updateTimeDisplay(t) {
  timeDisplay.textContent = `${Math.round(t)}ms / ${currentDuration}ms`;
}

fpsInput.addEventListener('change', () => {
  // FPS affects preview throttling and export.
  frameAccumulator = 0;
  lastFrameTimestamp = 0;
});

function initEditor() {
  if (!editorTextarea || !window.CodeMirror) {
    if (lintStatus) lintStatus.textContent = "Editor unavailable";
    return;
  }

  editorView = window.CodeMirror.fromTextArea(editorTextarea, {
    mode: "application/xml",
    lineNumbers: true,
    lineWrapping: true,
    gutters: ["CodeMirror-linenumbers", "lint-gutter"],
    extraKeys: {
      "Shift-Alt-F": () => formatXmlInEditor(),
      "Ctrl-F": "findPersistent",
      "Cmd-F": "findPersistent",
      "Ctrl-H": "replace",
      "Cmd-Alt-F": "replace",
      "Ctrl-Shift-H": "replaceAll",
      "Cmd-Shift-Alt-F": "replaceAll"
    }
  });

  const lintXml = () => {
    const xmlText = editorView.getValue();

    if (!xmlText.trim()) {
      editorView.clearGutter("lint-gutter");
      if (lintStatus) lintStatus.textContent = "No XML loaded";
      return;
    }

    const domParser = new DOMParser();
    const doc = domParser.parseFromString(xmlText, "application/xml");
    const errorNode = doc.querySelector("parsererror");

    editorView.clearGutter("lint-gutter");

    if (errorNode) {
      const message = errorNode.textContent.trim().split("\n")[0] || "Invalid XML";
      const marker = document.createElement("div");
      marker.className = "cm-lint-marker";
      marker.title = message;
      editorView.setGutterMarker(0, "lint-gutter", marker);
      if (lintStatus) lintStatus.textContent = "XML error";
      return;
    }

    if (lintStatus) lintStatus.textContent = "XML OK";
  };

  const scheduleLiveUpdate = () => {
    const xmlText = editorView.getValue();
    if (!xmlText.trim()) return;

    if (liveUpdateTimer) {
      clearTimeout(liveUpdateTimer);
    }

    liveUpdateTimer = setTimeout(() => {
      applyXmlToPreview(xmlText);
    }, 300);
  };

  editorView.on("changes", () => {
    lintXml();
    scheduleLiveUpdate();
  });
  lintXml();
}

function formatXml(xmlText) {
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(xmlText, "application/xml");
  const errorNode = doc.querySelector("parsererror");

  if (errorNode) {
    return { formatted: xmlText, ok: false };
  }

  const escapeText = (value) => {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  const escapeAttr = (value) => {
    return escapeText(value).replace(/"/g, "&quot;");
  };

  const serializeNode = (node, depth) => {
    const indent = "  ".repeat(depth);

    const buildStartTag = (tagName, attrs, selfClosing) => {
      if (!attrs || attrs.length === 0) {
        return selfClosing ? `${indent}<${tagName}/>` : `${indent}<${tagName}>`;
      }

      const inline = `${indent}<${tagName} ${attrs.join(" ")}${selfClosing ? "/" : ""}>`;
      if (inline.length <= 72) {
        return inline;
      }

      const lines = [`${indent}<${tagName}`];
      attrs.forEach((attr, index) => {
        const isLast = index === attrs.length - 1;
        const suffix = isLast ? (selfClosing ? "/>" : ">") : "";
        lines.push(`${indent}  ${attr}${suffix}`);
      });
      return lines.join("\n");
    };

    switch (node.nodeType) {
      case Node.ELEMENT_NODE: {
        const tagName = node.nodeName;
        const attrs = Array.from(node.attributes || [])
          .map((attr) => `${attr.name}="${escapeAttr(attr.value)}"`)
          .filter(Boolean);

        const childNodes = Array.from(node.childNodes || []);
        const elementChildren = childNodes.filter((child) => child.nodeType === Node.ELEMENT_NODE);
        const textChildren = childNodes.filter((child) => child.nodeType === Node.TEXT_NODE && child.nodeValue.trim() !== "");
        const otherChildren = childNodes.filter((child) => child.nodeType !== Node.TEXT_NODE && child.nodeType !== Node.ELEMENT_NODE);

        if (childNodes.length === 0) {
          return buildStartTag(tagName, attrs, true);
        }

        if (elementChildren.length === 0 && otherChildren.length === 0 && textChildren.length === 1) {
          const textValue = escapeText(textChildren[0].nodeValue.trim());
          const startTag = buildStartTag(tagName, attrs, false);
          if (startTag.includes("\n")) {
            return `${startTag}\n${indent}  ${textValue}\n${indent}</${tagName}>`;
          }
          return `${startTag}${textValue}</${tagName}>`;
        }

        const startTag = buildStartTag(tagName, attrs, false);
        const lines = startTag.split("\n");
        childNodes.forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) {
            const textValue = child.nodeValue.trim();
            if (textValue) {
              lines.push(`${indent}  ${escapeText(textValue)}`);
            }
          } else {
            lines.push(serializeNode(child, depth + 1));
          }
        });
        lines.push(`${indent}</${tagName}>`);
        return lines.join("\n");
      }
      case Node.TEXT_NODE: {
        const textValue = node.nodeValue.trim();
        return textValue ? `${indent}${escapeText(textValue)}` : "";
      }
      case Node.CDATA_SECTION_NODE: {
        return `${indent}<![CDATA[${node.nodeValue}]]>`;
      }
      case Node.COMMENT_NODE: {
        return `${indent}<!--${node.nodeValue}-->`;
      }
      case Node.PROCESSING_INSTRUCTION_NODE: {
        return `${indent}<?${node.nodeName} ${node.nodeValue}?>`;
      }
      default:
        return "";
    }
  };

  const root = doc.documentElement;
  if (!root) {
    return { formatted: xmlText, ok: false };
  }

  const formatted = serializeNode(root, 0).trim();
  return { formatted, ok: true };
}

function formatXmlInEditor() {
  if (!editorView) return;
  const xmlText = editorView.getValue();
  if (!xmlText.trim()) return;

  const { formatted, ok } = formatXml(xmlText);
  if (!ok) {
    if (lintStatus) lintStatus.textContent = "XML error";
    return;
  }

  editorView.setValue(formatted);
}

function setEditorContent(xml) {
  if (!editorView) return;
  const current = editorView.getValue();
  if (current === xml) return;

  editorView.setValue(xml);
}

function saveXmlToFile() {
  if (!editorView) return;
  const xmlText = editorView.getValue();
  if (!xmlText.trim()) return;

  const safeName = currentFileName && currentFileName.toLowerCase().endsWith('.xml')
    ? currentFileName
    : 'vector.xml';

  const blob = new Blob([xmlText], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

initEditor();

const setMenuOpen = (section, isOpen) => {
  if (!section) return;
  const button = section.querySelector('.menu-title');
  if (isOpen) {
    section.classList.add('open');
    button?.setAttribute('aria-expanded', 'true');
  } else {
    section.classList.remove('open');
    button?.setAttribute('aria-expanded', 'false');
  }
};

const closeMenusExcept = (activeSection) => {
  menuSections.forEach((section) => {
    if (section !== activeSection) {
      setMenuOpen(section, false);
    }
  });
};

const anyMenuOpen = () => menuSections.some((section) => section.classList.contains('open'));

menuSections.forEach((section) => {
  const button = section.querySelector('.menu-title');
  button?.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = section.classList.contains('open');
    if (isOpen) {
      setMenuOpen(section, false);
    } else {
      closeMenusExcept(section);
      setMenuOpen(section, true);
    }
  });

  button?.addEventListener('mouseenter', () => {
    if (anyMenuOpen() && !section.classList.contains('open')) {
      closeMenusExcept(section);
      setMenuOpen(section, true);
    }
  });

  section.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('.menu-title')) return;
    if (target.closest('.menu-content') && target.closest('button')) {
      setMenuOpen(section, false);
    }
  });
});

document.addEventListener('click', (event) => {
  const clickedInsideMenu = menuSections.some((section) => section.contains(event.target));
  if (!clickedInsideMenu) {
    menuSections.forEach((section) => setMenuOpen(section, false));
  }
});

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 's') {
    event.preventDefault();
    saveXmlToFile();
    menuSections.forEach((section) => setMenuOpen(section, false));
  }
});

btnFormatXml?.addEventListener('click', () => {
  formatXmlInEditor();
});

btnSaveXml?.addEventListener('click', () => {
  saveXmlToFile();
});

btnOpenXml?.addEventListener('click', () => {
  fileInput?.click();
});

btnGithub?.addEventListener('click', () => {
  window.open('https://github.com/brahmkshatriya/', '_blank', 'noopener,noreferrer');
});

btnSearch?.addEventListener('click', () => {
  if (!editorView) return;
  editorView.execCommand('findPersistent');
});

btnReplace?.addEventListener('click', () => {
  if (!editorView) return;
  editorView.execCommand('replace');
});

const setTopControlsCollapsed = (collapsed) => {
  if (!previewTopControls) return;
  previewTopControls.classList.toggle('is-collapsed', collapsed);
  if (btnToggleTopPanel) {
    const icon = btnToggleTopPanel.querySelector('.material-symbols-rounded');
    if (icon) {
      icon.textContent = collapsed ? 'expand_more' : 'expand_less';
    }
    btnToggleTopPanel.setAttribute('aria-label', collapsed ? 'Show controls' : 'Hide controls');
  }
};

btnToggleTopPanel?.addEventListener('click', () => {
  const collapsed = previewTopControls?.classList.contains('is-collapsed');
  setTopControlsCollapsed(!collapsed);
});

btnShowTopPanel?.addEventListener('click', () => {
  setTopControlsCollapsed(false);
});

// Playback Logic
function getPreviewFrameDuration() {
  const fps = parseInt(fpsInput?.value, 10);
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 60;
  return 1000 / safeFps;
}

function loop(timestamp) {
  if (!isPlaying) return;
  if (currentDuration <= 0) return;

  if (!lastFrameTimestamp) {
    lastFrameTimestamp = timestamp;
  }

  const delta = timestamp - lastFrameTimestamp;
  lastFrameTimestamp = timestamp;

  const frameDuration = getPreviewFrameDuration();
  frameAccumulator += delta * playbackRate;

  let advanced = false;
  while (frameAccumulator >= frameDuration) {
    frameAccumulator -= frameDuration;
    let nextTime = pausedTime + frameDuration;

    if (!isRepeat && nextTime >= currentDuration) {
      pausedTime = currentDuration;
      updateUIForTime(pausedTime);
      renderer.render(pausedTime);
      pause();
      return;
    }

    if (nextTime >= currentDuration) {
      nextTime = nextTime % currentDuration;
    }

    pausedTime = nextTime;
    advanced = true;
  }

  if (advanced) {
    updateUIForTime(pausedTime);
    renderer.render(pausedTime);
  }

  animationId = requestAnimationFrame(loop);
}

function play() {
  if (isPlaying) return;
  if (!avdData) return;
  if (currentDuration <= 0) return;

  isPlaying = true;
  lastFrameTimestamp = 0;
  frameAccumulator = 0;
  updatePlayPauseButton();

  loop(performance.now());
}

function pause() {
  isPlaying = false;
  cancelAnimationFrame(animationId);
  updatePlayPauseButton();
}

function updateUIForTime(t) {
  timeline.value = t;
  updateTimeDisplay(t);
}

function updatePlayPauseButton() {
  if (!btnPlayPause) return;
  const icon = btnPlayPause.querySelector('.material-symbols-rounded');
  if (icon) {
    icon.textContent = isPlaying ? 'pause' : 'play_arrow';
  }
  btnPlayPause.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
}

function togglePlayPause() {
  if (isPlaying) {
    pause();
  } else {
    play();
  }
}

function setPlaybackRate(rate) {
  playbackRate = rate;
  if (speedToggle) {
    const icon = speedToggle.querySelector('.material-symbols-rounded');
    if (icon) {
      if (rate === 0.5) {
        icon.textContent = 'speed_0_5x';
      } else if (rate === 2) {
        icon.textContent = 'speed_2x';
      } else {
        icon.textContent = '1x_mobiledata';
      }
    }
    speedToggle.setAttribute('aria-label', `Playback speed ${rate}x`);
    speedToggle.setAttribute('aria-pressed', 'true');
  }

  if (isPlaying) {
    lastFrameTimestamp = 0;
    frameAccumulator = 0;
  }
}

function setRepeatState(nextValue) {
  isRepeat = nextValue;
  if (btnRepeat) {
    btnRepeat.setAttribute('aria-pressed', isRepeat ? 'true' : 'false');
    btnRepeat.setAttribute('aria-label', isRepeat ? 'Repeat on' : 'Repeat off');
    const icon = btnRepeat.querySelector('.material-symbols-rounded');
    if (icon) {
      icon.textContent = isRepeat ? 'repeat_on' : 'repeat';
    }
  }
}

function stepBy(delta) {
  pause();
  const stepMs = Math.max(currentDuration / 60, 50);
  pausedTime = Math.min(currentDuration, Math.max(0, pausedTime + delta * stepMs));
  updateUIForTime(pausedTime);
  renderer.render(pausedTime);
}

btnPlayPause?.addEventListener('click', togglePlayPause);
btnStepBack?.addEventListener('click', () => stepBy(-1));
btnStepForward?.addEventListener('click', () => stepBy(1));
btnRepeat?.addEventListener('click', () => setRepeatState(!isRepeat));

speedToggle?.addEventListener('click', () => {
  const index = speedSteps.indexOf(playbackRate);
  const nextIndex = index === -1 ? 1 : (index + 1) % speedSteps.length;
  setPlaybackRate(speedSteps[nextIndex]);
});

timeline.addEventListener('input', (e) => {
  pause();
  const t = parseFloat(e.target.value);
  pausedTime = t;
  updateTimeDisplay(t);
  renderer.render(t);
});

const zoomConfig = {
  min: 0.2,
  max: 5,
  step: 0.1,
  wheelSensitivity: 0.001,
  padding: 24
};

function updateZoomLabel() {
  if (zoomLevelLabel) {
    zoomLevelLabel.textContent = `${Math.round(viewState.zoom * 100)}%`;
  }
}

function applyViewTransform() {
  canvas.style.transform = `translate(${viewState.panX}px, ${viewState.panY}px) scale(${viewState.zoom})`;
  updateZoomLabel();
}

function getViewportRect() {
  return previewViewport ? previewViewport.getBoundingClientRect() : null;
}

function getContentSize(zoom = viewState.zoom) {
  return {
    width: canvas.width * zoom,
    height: canvas.height * zoom
  };
}

function centerCanvas(zoom = viewState.zoom) {
  const rect = getViewportRect();
  if (!rect) return;
  const { width, height } = getContentSize(zoom);
  viewState.panX = (rect.width - width) / 2;
  viewState.panY = (rect.height - height) / 2;
}

function clampZoom(value) {
  return Math.min(zoomConfig.max, Math.max(zoomConfig.min, value));
}

function setZoomLevel(nextZoom, originX = null, originY = null) {
  const clamped = clampZoom(nextZoom);
  if (originX !== null && originY !== null) {
    const scale = clamped / viewState.zoom;
    viewState.panX = originX - (originX - viewState.panX) * scale;
    viewState.panY = originY - (originY - viewState.panY) * scale;
  }
  viewState.zoom = clamped;
  applyViewTransform();
}

function fitCanvasToViewport() {
  const rect = getViewportRect();
  if (!rect) return;
  const availableWidth = Math.max(0, rect.width - zoomConfig.padding * 2);
  const availableHeight = Math.max(0, rect.height - zoomConfig.padding * 2);
  const scaleX = availableWidth / canvas.width;
  const scaleY = availableHeight / canvas.height;
  const nextZoom = clampZoom(Math.min(scaleX, scaleY));
  viewState.zoom = nextZoom;
  centerCanvas(nextZoom);
  applyViewTransform();
}

function resetView() {
  fitCanvasToViewport();
}

btnZoomIn?.addEventListener('click', () => setZoomLevel(viewState.zoom + zoomConfig.step));
btnZoomOut?.addEventListener('click', () => setZoomLevel(viewState.zoom - zoomConfig.step));
btnZoomReset?.addEventListener('click', resetView);

previewViewport?.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = previewViewport.getBoundingClientRect();
  const originX = e.clientX - rect.left;
  const originY = e.clientY - rect.top;
  const zoomFactor = Math.exp(-e.deltaY * zoomConfig.wheelSensitivity);
  setZoomLevel(viewState.zoom * zoomFactor, originX, originY);
}, { passive: false });

previewViewport?.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  isPanning = true;
  panStart = { x: e.clientX, y: e.clientY, panX: viewState.panX, panY: viewState.panY };
  previewViewport.setPointerCapture(e.pointerId);
  previewViewport.classList.add('panning');
});

previewViewport?.addEventListener('pointermove', (e) => {
  if (!isPanning) return;
  const dx = e.clientX - panStart.x;
  const dy = e.clientY - panStart.y;
  viewState.panX = panStart.panX + dx;
  viewState.panY = panStart.panY + dy;
  applyViewTransform();
});

previewViewport?.addEventListener('pointerup', (e) => {
  isPanning = false;
  previewViewport.releasePointerCapture(e.pointerId);
  previewViewport.classList.remove('panning');
});

previewViewport?.addEventListener('pointerleave', () => {
  isPanning = false;
  previewViewport.classList.remove('panning');
});

previewViewport?.addEventListener('pointercancel', () => {
  isPanning = false;
  previewViewport.classList.remove('panning');
});

previewViewport?.addEventListener('dblclick', () => {
  resetView();
});

panelResizer?.addEventListener('pointerdown', (e) => {
  if (!workspace || !editorPanel || !previewPanel) return;
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const startWidth = editorPanel.getBoundingClientRect().width;
  const startHeight = editorPanel.getBoundingClientRect().height;
  const previousCursor = document.body.style.cursor;
  document.body.style.cursor = window.matchMedia('(max-width: 900px)').matches ? 'row-resize' : 'col-resize';
  document.body.style.userSelect = 'none';

  const minEditorWidth = 200;
  const minPreviewWidth = 240;
  const minEditorHeight = 220;
  const minPreviewHeight = 240;

  const onMove = (evt) => {
    const isVertical = window.matchMedia('(max-width: 900px)').matches;
    const workspaceRect = workspace.getBoundingClientRect();
    const resizerSize = isVertical
      ? panelResizer.getBoundingClientRect().height
      : panelResizer.getBoundingClientRect().width;
    if (isVertical) {
      const delta = evt.clientY - startY;
      const maxEditorHeight = Math.max(minEditorHeight, workspaceRect.height - minPreviewHeight - resizerSize);
      const nextHeight = Math.min(maxEditorHeight, Math.max(minEditorHeight, startHeight + delta));
      editorPanel.style.flexBasis = `${nextHeight}px`;
    } else {
      const delta = evt.clientX - startX;
      const maxEditorWidth = Math.max(minEditorWidth, workspaceRect.width - minPreviewWidth - resizerSize);
      const nextWidth = Math.min(maxEditorWidth, Math.max(minEditorWidth, startWidth + delta));
      editorPanel.style.flexBasis = `${nextWidth}px`;
    }
  };

  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = '';
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
});

updatePlayPauseButton();
setRepeatState(true);
setPlaybackRate(1);
resetView();

// Export Logic
btnExport.addEventListener('click', async () => {
  if (!avdData) return;

  const fps = parseInt(fpsInput.value) || 60;
  const interval = 1000 / fps;
  const totalFrames = Math.ceil(currentDuration / interval); // or floor?

  const zip = new JSZip();
  const folder = zip.folder("frames");

  exportStatus.textContent = "Generating frames...";
  btnExport.disabled = true;

  // We must render sequentially.
  // We can't block UI too long, so maybe async batching?

  let frame = 0;

  function processBatch() {
    const batchSize = 10;
    let p = Promise.resolve();

    for (let i = 0; i < batchSize && frame < totalFrames; i++) {
      const t = frame * interval;
      renderer.render(t);

      // Get data URL
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.split(',')[1];
      const fileName = `frame_${frame.toString().padStart(4, '0')}.png`;

      folder.file(fileName, base64, { base64: true });
      frame++;
    }

    if (frame < totalFrames) {
      exportStatus.textContent = `Generated ${frame}/${totalFrames} frames...`;
      setTimeout(processBatch, 0); // Yield to UI
    } else {
      // Done
      exportStatus.textContent = "Zipping...";
      zip.generateAsync({ type: "blob" }).then(function (content) {
        saveAs(content, "avd_frames.zip");
        exportStatus.textContent = "Done!";
        btnExport.disabled = false;
        // Restore preview
        renderer.render(pausedTime);
      });
    }
  }

  // Start
  processBatch();
});

// MP4 Export Logic
import * as Mp4Muxer from "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.4/build/mp4-muxer.mjs";

btnExportMp4.addEventListener('click', async () => {
  if (!avdData) return;
  if (!window.VideoEncoder) {
    alert("Your browser does not support VideoEncoder (WebCodecs). Please use a modern browser (Chrome/Edge/Firefox).");
    return;
  }

  const fps = parseInt(fpsInput.value) || 60;
  const width = canvas.width;
  const height = canvas.height;
  // VideoEncoder usually requires even dimensions
  if (width % 2 !== 0 || height % 2 !== 0) {
    alert(`Canvas dimensions must be even for video encoding. Current: ${width}x${height}. Please adjust scale.`);
    return;
  }

  const interval = 1000 / fps; // ms per frame
  const totalFrames = Math.ceil(currentDuration / interval);

  exportStatus.textContent = "Initializing encoder...";
  btnExportMp4.disabled = true;

  // 1. Setup Muxer
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc', // H.264
      width: width,
      height: height
    },
    fastStart: 'in-memory'
  });

  // 2. Setup Encoder
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error(e);
      exportStatus.textContent = "Encoding Error: " + e.message;
      btnExportMp4.disabled = false;
    }
  });

  encoder.configure({
    codec: 'avc1.42001f', // Baseline Profile Level 3.1
    width: width,
    height: height,
    bitrate: 2_000_000, // 2 Mbps
    framerate: fps
  });

  // 3. Render and Encode Loop
  let frame = 0;

  async function processMp4Batch() {
    // Larger batch size for encoding? Encoded frames are small, but rendering takes time.
    // We need to await flush? No, just encode.
    const batchSize = 5;

    for (let i = 0; i < batchSize && frame < totalFrames; i++) {
      const timeMs = frame * interval;
      renderer.render(timeMs);

      // Timestamp in microseconds
      const timestamp = frame * (1_000_000 / fps);
      const duration = 1_000_000 / fps;

      const videoFrame = new VideoFrame(canvas, { timestamp: timestamp, duration: duration });

      encoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 });
      videoFrame.close();

      frame++;
    }

    if (frame < totalFrames) {
      exportStatus.textContent = `Encoded ${frame}/${totalFrames} frames...`;
      // Yield
      setTimeout(processMp4Batch, 0);
    } else {
      finishEncoding();
    }
  }

  async function finishEncoding() {
    exportStatus.textContent = "Finalizing...";
    await encoder.flush();
    muxer.finalize();

    const { buffer } = muxer.target;
    const blob = new Blob([buffer], { type: 'video/mp4' });
    saveAs(blob, "avd_animation.mp4");

    exportStatus.textContent = "MP4 Done!";
    btnExportMp4.disabled = false;
    renderer.render(pausedTime);
  }

  processMp4Batch();
});


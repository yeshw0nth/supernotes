// --- DOM Elements ---
const notesListContainer = document.getElementById('notes-list');
const newNoteBtn = document.getElementById('new-note-btn');
const deleteNoteBtn = document.getElementById('delete-note-btn');
const noteTitleInput = document.getElementById('note-title');
const noteTextEditor = document.getElementById('note-text-editor');
const noteTimestamp = document.getElementById('note-timestamp');
const editorPanel = document.getElementById('editor-panel');
const disabledOverlay = document.getElementById('disabled-overlay');
const noteContentArea = document.querySelector('.note-content-area');

// Canvas & Drawing Tools Elements
const canvas = document.getElementById('note-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Optimization hint
const drawingToolbar = document.getElementById('drawing-toolbar');
const penToolBtn = document.getElementById('tool-pen');
const eraserToolBtn = document.getElementById('tool-eraser');
const colorPicker = document.getElementById('color-picker');
const lineWidthRange = document.getElementById('line-width');
const lineWidthDisplay = document.getElementById('line-width-display');
const clearCanvasBtn = document.getElementById('clear-canvas-btn');

// Modal elements
const confirmationModal = document.getElementById('confirmation-modal');
const modalMessage = document.getElementById('modal-message');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');

// --- State ---
let notes = []; // Array to hold note objects { id, title, contentHTML, drawingData, createdAt, updatedAt }
let activeNoteId = null;
let debounceTimer;
const DEBOUNCE_DELAY = 600; // ms delay for auto-save

// Drawing State
let isDrawing = false;
let currentTool = 'pen'; // 'pen' or 'eraser'
let lastX = 0;
let lastY = 0;
let currentLineWidth = 3;
let currentColor = '#000000';
let history = []; // For potential undo/redo later
let historyIndex = -1;

// --- Local Storage ---
const STORAGE_KEY = 'superNotes_notes_v2.1'; // Incremented version slightly

function loadNotes() {
    try {
        const storedNotes = localStorage.getItem(STORAGE_KEY);
        notes = storedNotes ? JSON.parse(storedNotes) : [];
        notes.forEach(note => { // Ensure dates are Date objects
            note.createdAt = new Date(note.createdAt);
            note.updatedAt = new Date(note.updatedAt);
        });
        notes.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
        console.error("Error loading notes from localStorage:", error);
        notes = []; // Reset notes if loading fails
        // Optionally, notify the user
    }
}

function saveNotes() {
    try {
        notes.sort((a, b) => b.updatedAt - a.updatedAt); // Sort before saving
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch (error) {
        console.error("Error saving notes to localStorage:", error);
        // Optionally, notify the user that saving failed
        showModal("Error: Could not save notes. Local storage might be full or disabled.", hideModal); // Use modal for errors
    }
}

// --- Canvas Functions ---

function resizeCanvas() {
    // Save current drawing state before resize
    const currentDrawing = activeNoteId ? canvas.toDataURL() : null;

    // Calculate available space more dynamically
    const editorRect = editorPanel.getBoundingClientRect();
    const topBarRect = editorPanel.querySelector('.p-2.border-b').getBoundingClientRect();
    const titleRect = noteTitleInput.getBoundingClientRect();
    const toolbarRect = drawingToolbar.getBoundingClientRect();
    const textEditorRect = noteTextEditor.getBoundingClientRect();

    const availableHeight = editorRect.height - topBarRect.height - titleRect.height - toolbarRect.height - textEditorRect.height;
    const availableWidth = noteContentArea.clientWidth; // Use content area width

    const dpr = window.devicePixelRatio || 1;
    canvas.width = availableWidth * dpr;
    // Ensure minimum canvas height, prevent negative values
    canvas.height = Math.max(150 * dpr, availableHeight * dpr);

    canvas.style.width = `${availableWidth}px`;
    canvas.style.height = `${Math.max(150, availableHeight)}px`;

    ctx.scale(dpr, dpr); // Scale context AFTER setting width/height

    // Re-apply drawing settings
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentLineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = (currentTool === 'eraser') ? 'destination-out' : 'source-over';

    // Restore the drawing after resize
    if (currentDrawing) {
        loadDrawing(currentDrawing, false); // Load without clearing history
    } else {
        clearDrawingArea(false, false); // Clear without saving or clearing history
    }
}


function startDrawing(e) {
    if (!activeNoteId || e.button !== 0) return; // Only draw for left mouse button or touch
    isDrawing = true;
    [lastX, lastY] = getCanvasCoordinates(e);

    // Set drawing style for the new path
    ctx.lineWidth = (currentTool === 'eraser') ? currentLineWidth * 1.5 : currentLineWidth; // Make eraser slightly larger
    ctx.strokeStyle = currentColor;
    ctx.globalCompositeOperation = (currentTool === 'eraser') ? 'destination-out' : 'source-over';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);

    // Add small dot for clicks without dragging
     ctx.fillStyle = currentColor; // Use current color for the dot
     if (currentTool === 'pen') {
         ctx.beginPath();
         ctx.arc(lastX, lastY, currentLineWidth / 2, 0, Math.PI * 2);
         ctx.fill();
     }
}

function draw(e) {
    if (!isDrawing || !activeNoteId) return;
    const [currentX, currentY] = getCanvasCoordinates(e);

    // Draw the line segment
    ctx.lineTo(currentX, currentY);
    ctx.stroke();

    // Update last position
    [lastX, lastY] = [currentX, currentY];
}

function stopDrawing() {
    if (!isDrawing) return;
    ctx.closePath(); // Complete the current path
    isDrawing = false;
    // Save state for potential undo/redo here if implementing
    // saveHistory();
    handleNoteUpdate(); // Trigger debounced save
}

// Helper to get coordinates relative to the canvas element
function getCanvasCoordinates(event) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }

    // Calculate logical coordinates considering device pixel ratio and CSS scaling
    const scaleX = canvas.width / (rect.width * window.devicePixelRatio);
    const scaleY = canvas.height / (rect.height * window.devicePixelRatio);

    // Return coordinates adjusted for canvas context scale
    return [
        (clientX - rect.left) * scaleX * window.devicePixelRatio,
        (clientY - rect.top) * scaleY * window.devicePixelRatio
    ];
}


function clearDrawingArea(triggerSave = true, clearHistoryFlag = true) {
    const currentFill = ctx.fillStyle;
    const currentCompositeOp = ctx.globalCompositeOperation; // Save current operation

    ctx.globalCompositeOperation = 'source-over'; // Ensure clearing works correctly
    ctx.fillStyle = getComputedStyle(canvas).backgroundColor || '#fffbeb'; // Use canvas bg color
    // Use clearRect for efficiency instead of fillRect over the whole area
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Restore previous settings
    ctx.fillStyle = currentFill;
    ctx.globalCompositeOperation = currentCompositeOp;

    // Reset history if requested
    // if (clearHistoryFlag) {
    //     history = [];
    //     historyIndex = -1;
    //     saveHistory(); // Save the cleared state as the first history step
    // }

    if (triggerSave) {
        const activeNote = notes.find(note => note.id === activeNoteId);
        if (activeNote) {
            if (activeNote.drawingData !== null) { // Only update if it wasn't already null
                activeNote.drawingData = null;
                activeNote.updatedAt = new Date();
                saveNotes();
                renderNotesList(); // Update timestamp
                noteTimestamp.textContent = `Last updated: ${formatDate(activeNote.updatedAt, true)}`;
            }
        }
    }
}

function loadDrawing(dataURL, clearHistoryFlag = true) {
    // if (clearHistoryFlag) {
    //     history = []; // Reset history when loading a new drawing
    //     historyIndex = -1;
    // }

    if (!dataURL) {
        clearDrawingArea(false, clearHistoryFlag); // Clear canvas if no data, respect history flag
        // if (clearHistoryFlag) saveHistory(); // Save the cleared state
        return;
    }

    const img = new Image();
    img.onload = () => {
        // Clear existing content before drawing loaded image
        clearDrawingArea(false, false); // Clear without saving or affecting history stack yet
        // Draw the loaded image, adjusting for device pixel ratio
        ctx.drawImage(img, 0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
        // if (clearHistoryFlag) saveHistory(); // Save the loaded state as the first history step
    };
    img.onerror = (err) => {
        console.error("Error loading drawing data:", err);
        clearDrawingArea(false, clearHistoryFlag); // Clear canvas on error
        // if (clearHistoryFlag) saveHistory(); // Save the cleared state
        showModal("Error: Could not load the drawing for this note.", hideModal);
    };
    img.src = dataURL;
}

// --- UI Rendering ---
function renderNotesList() {
    notesListContainer.innerHTML = '';
    if (notes.length === 0) {
        notesListContainer.innerHTML = '<p class="text-center text-gray-500 p-4">No notes yet. Click + to start!</p>';
        return;
    }
    notes.forEach(note => {
        const noteElement = createNoteListItem(note);
        notesListContainer.appendChild(noteElement);
    });
    highlightActiveNote();
}

function createNoteListItem(note) {
    const div = document.createElement('div');
    // Add transition for smoother background change
    div.className = `note-item p-3 border-b border-gray-200 cursor-pointer hover:bg-gray-100 rounded-md m-1 transition-colors duration-150 ${note.id === activeNoteId ? 'active' : ''}`;
    div.dataset.noteId = note.id;

    const titleText = note.title || 'Untitled Note';
    // Create preview from HTML content (strip tags)
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = note.contentHTML || '';
    const textPreview = (tempDiv.textContent || tempDiv.innerText || '').trim();
    let previewText = textPreview.substring(0, 50).replace(/\n/g, ' ') + (textPreview.length > 50 ? '...' : '');

    // Add indicator if there's a drawing but no text preview
    if (!previewText && note.drawingData) {
        previewText = '[Drawing]';
    } else if (!previewText && !note.drawingData) {
         previewText = 'No additional text';
    }

    const dateString = formatDate(note.updatedAt);

    div.innerHTML = `
        <h4 class="font-semibold text-gray-900 truncate text-sm mb-1">${escapeHTML(titleText)}</h4>
        <p class="text-xs text-gray-600 truncate mb-1">${escapeHTML(previewText)}</p>
        <span class="text-xs text-gray-400">${dateString}</span>
    `;
    div.addEventListener('click', () => handleNoteSelect(note.id));
    return div;
}

function renderEditor() {
    const activeNote = notes.find(note => note.id === activeNoteId);

    if (activeNote) {
        editorPanel.classList.add('editor-active'); // Add class to hide overlay
        noteTitleInput.value = activeNote.title;
        noteTextEditor.innerHTML = activeNote.contentHTML || '';
        noteTimestamp.textContent = `Last updated: ${formatDate(activeNote.updatedAt, true)}`;

        // Enable inputs and buttons
        noteTitleInput.disabled = false;
        noteTextEditor.contentEditable = true;
        deleteNoteBtn.disabled = false;
        drawingToolbar.style.pointerEvents = 'auto';
        drawingToolbar.style.opacity = '1';

        // Load drawing (this will also handle clearing if no data)
        loadDrawing(activeNote.drawingData);

    } else {
        editorPanel.classList.remove('editor-active'); // Remove class to show overlay
        noteTitleInput.value = '';
        noteTextEditor.innerHTML = '';
        noteTimestamp.textContent = 'Select or create a note';
        clearDrawingArea(false, false); // Clear canvas without saving or clearing history

        // Disable inputs and buttons
        noteTitleInput.disabled = true;
        noteTextEditor.contentEditable = false;
        deleteNoteBtn.disabled = true;
        drawingToolbar.style.pointerEvents = 'none';
        drawingToolbar.style.opacity = '0.5';
    }
    highlightActiveNote();
     // Ensure canvas is correctly sized AFTER content is potentially loaded
     requestAnimationFrame(resizeCanvas);
}

function highlightActiveNote() {
    document.querySelectorAll('.note-item').forEach(item => {
        const isSelected = item.dataset.noteId === activeNoteId;
        item.classList.toggle('active', isSelected);
        if (isSelected) {
            // Scroll into view only if necessary
            const listRect = notesListContainer.getBoundingClientRect();
            const itemRect = item.getBoundingClientRect();
            if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
                 item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    });
}

// --- Event Handlers ---
function handleNewNote() {
    const now = new Date();
    const newNote = {
        id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        title: '',
        contentHTML: '',
        drawingData: null,
        createdAt: now,
        updatedAt: now
    };
    notes.unshift(newNote);
    activeNoteId = newNote.id;
    saveNotes();
    renderNotesList();
    renderEditor();
    noteTitleInput.focus();
}

function handleNoteSelect(noteId) {
    if (activeNoteId === noteId) return;
    activeNoteId = noteId;
    renderEditor();
}

function handleNoteUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const activeNote = notes.find(note => note.id === activeNoteId);
        if (activeNote) {
            const newTitle = noteTitleInput.value;
            const newContentHTML = noteTextEditor.innerHTML;
            // Get canvas data only if it's not blank, otherwise store null
            const currentDrawingData = isCanvasBlank() ? null : canvas.toDataURL();
            const now = new Date();

            // Check if anything actually changed
            if (activeNote.title !== newTitle ||
                activeNote.contentHTML !== newContentHTML ||
                activeNote.drawingData !== currentDrawingData) // Compare with potentially null value
            {
                activeNote.title = newTitle;
                activeNote.contentHTML = newContentHTML;
                activeNote.drawingData = currentDrawingData; // Assign the potentially null value
                activeNote.updatedAt = now;

                // Move updated note to the top
                notes = notes.filter(note => note.id !== activeNoteId);
                notes.unshift(activeNote);

                saveNotes();
                renderNotesList(); // Update list (preview, order, timestamp)
                noteTimestamp.textContent = `Last updated: ${formatDate(now, true)}`;
            }
        }
    }, DEBOUNCE_DELAY);
}

// Improved check if canvas is blank (checks against background color)
function isCanvasBlank() {
    try {
        // Get background color and convert to RGBA for comparison
        const bgColor = getComputedStyle(canvas).backgroundColor;
        const tempCtx = document.createElement('canvas').getContext('2d');
        tempCtx.fillStyle = bgColor;
        tempCtx.fillRect(0, 0, 1, 1);
        const [bgR, bgG, bgB, bgA] = tempCtx.getImageData(0, 0, 1, 1).data;
        const bgAlpha = bgA / 255.0; // Normalize alpha

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3] / 255.0; // Normalize alpha

            // Check if pixel is different from background (considering alpha)
            // If pixel is fully transparent, treat as background
            if (a === 0) continue;
            // If pixel alpha matches background alpha, check RGB
            if (a === bgAlpha && r === bgR && g === bgG && b === bgB) continue;
            // If pixel alpha is different, or RGB is different, it's not blank
            return false;
        }
        return true; // All pixels match background or are transparent
    } catch (e) {
        console.error("Error checking if canvas is blank:", e);
        // Fallback: assume not blank if error occurs (safer than losing data)
        return false;
    }
}


function handleDeleteNote() {
     if (!activeNoteId) return;
     const noteToDelete = notes.find(note => note.id === activeNoteId);
     if (!noteToDelete) return;
     const noteTitle = noteToDelete.title || 'Untitled Note';

     showModal(`Delete note "<strong>${escapeHTML(noteTitle)}</strong>"?<br><small>This action cannot be undone.</small>`, () => {
         notes = notes.filter(note => note.id !== activeNoteId);
         const previousActiveId = activeNoteId; // Store ID before clearing
         activeNoteId = null;
         saveNotes();
         renderNotesList(); // Update list first
         renderEditor();   // Then clear/disable editor
         hideModal();

         // Optional: Select the next note in the list if available
         const deletedIndex = notes.findIndex(n => n.updatedAt < noteToDelete.updatedAt); // Find where it *would* have been
         if (notes.length > 0) {
            const nextIndex = Math.min(deletedIndex, notes.length - 1);
             // handleNoteSelect(notes[nextIndex].id); // Uncomment to auto-select next
         }
     });
}

// Drawing Toolbar Handlers
function handleToolSelect(tool) {
    currentTool = tool;
    penToolBtn.classList.toggle('active', tool === 'pen');
    eraserToolBtn.classList.toggle('active', tool === 'eraser');
    canvas.style.cursor = tool === 'pen' ? 'crosshair' : 'cell';
}

function handleColorChange(e) {
    currentColor = e.target.value;
    // Update context immediately only if pen tool is active
    if (currentTool === 'pen') {
         ctx.strokeStyle = currentColor;
    }
}

function handleLineWidthChange(e) {
    currentLineWidth = e.target.value;
    lineWidthDisplay.textContent = currentLineWidth.padStart(2, ' '); // Pad for alignment
     // Update context immediately
     ctx.lineWidth = (currentTool === 'eraser') ? currentLineWidth * 1.5 : currentLineWidth;
}

function handleClearCanvas() {
    if (!activeNoteId) return;
    showModal("Clear the drawing for this note?", () => {
        clearDrawingArea(true, true); // Clear, trigger save, clear history
        hideModal();
    });
}

// --- Modal Functions ---
let confirmCallback = null;
function showModal(message, onConfirm) {
    modalMessage.innerHTML = message; // Use innerHTML for potential HTML in message
    confirmCallback = onConfirm;
    confirmationModal.style.display = 'block';
    // Focus the cancel button by default for safety
    modalCancelBtn.focus();
}
function hideModal() {
    confirmationModal.style.display = 'none';
    confirmCallback = null;
}
// Add keyboard support for modal
function handleModalKeydown(event) {
    if (confirmationModal.style.display !== 'block') return;
    if (event.key === 'Enter' && typeof confirmCallback === 'function') {
        confirmCallback();
    } else if (event.key === 'Escape') {
        hideModal();
    }
}
modalConfirmBtn.addEventListener('click', () => { if (typeof confirmCallback === 'function') confirmCallback(); });
modalCancelBtn.addEventListener('click', hideModal);
modalCloseBtn.addEventListener('click', hideModal);
window.addEventListener('click', (event) => { if (event.target == confirmationModal) hideModal(); });
window.addEventListener('keydown', handleModalKeydown);


// --- Utility Functions ---
function formatDate(date, includeTime = false) {
     if (!(date instanceof Date) || isNaN(date)) return 'Invalid Date';
     const now = new Date();
     const isToday = date.toDateString() === now.toDateString();
     const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString();

     const timeOptions = { hour: 'numeric', minute: '2-digit' };
     const dateOptions = { month: 'short', day: 'numeric' };
     const yearOptions = { year: 'numeric', month: 'short', day: 'numeric' };

     if (isToday) {
         return `Today ${includeTime ? date.toLocaleTimeString(undefined, timeOptions) : ''}`;
     } else if (isYesterday) {
         return `Yesterday ${includeTime ? date.toLocaleTimeString(undefined, timeOptions) : ''}`;
     } else if (date.getFullYear() === new Date().getFullYear()) {
          return `${date.toLocaleDateString(undefined, dateOptions)}${includeTime ? ', ' + date.toLocaleTimeString(undefined, timeOptions) : ''}`;
     } else {
         return `${date.toLocaleDateString(undefined, yearOptions)}${includeTime ? ', ' + date.toLocaleTimeString(undefined, timeOptions) : ''}`;
     }
}
function escapeHTML(str) {
     const div = document.createElement('div');
     div.appendChild(document.createTextNode(str || '')); // Handle null/undefined
     return div.innerHTML;
}

// --- Initialization ---
function init() {
    console.log("SuperNotes Initializing...");
    // Note Listeners
    newNoteBtn.addEventListener('click', handleNewNote);
    deleteNoteBtn.addEventListener('click', handleDeleteNote);
    noteTitleInput.addEventListener('input', handleNoteUpdate);
    noteTextEditor.addEventListener('input', handleNoteUpdate);

    // Drawing Listeners (Mouse)
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', () => { if (isDrawing) stopDrawing(); });

     // Drawing Listeners (Touch) - Passive false to allow preventDefault
     canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDrawing(e); }, { passive: false });
     canvas.addEventListener('touchmove', (e) => { e.preventDefault(); draw(e); }, { passive: false });
     canvas.addEventListener('touchend', (e) => { e.preventDefault(); stopDrawing(); }, { passive: false });
     canvas.addEventListener('touchcancel', (e) => { e.preventDefault(); stopDrawing(); }, { passive: false });

    // Toolbar Listeners
    penToolBtn.addEventListener('click', () => handleToolSelect('pen'));
    eraserToolBtn.addEventListener('click', () => handleToolSelect('eraser'));
    colorPicker.addEventListener('input', handleColorChange);
    colorPicker.addEventListener('change', handleColorChange); // Catch final selection
    lineWidthRange.addEventListener('input', handleLineWidthChange);
    clearCanvasBtn.addEventListener('click', handleClearCanvas);

    // Window Listener for Resize
    // Debounce resize handler for performance
    let resizeDebounceTimer;
    window.addEventListener('resize', () => {
         clearTimeout(resizeDebounceTimer);
         resizeDebounceTimer = setTimeout(() => {
             if (activeNoteId) {
                 console.log("Resizing canvas...");
                 resizeCanvas();
             }
         }, 150); // Adjust delay as needed
    });

    // Load notes & Initial Render
    loadNotes();
    renderNotesList();
    renderEditor(); // Renders initial empty/disabled state & calls initial resize

    // Select the most recent note automatically if notes exist
    if (notes.length > 0) {
        handleNoteSelect(notes[0].id);
    } else {
        // Ensure canvas is sized correctly even if no notes exist initially
        // resizeCanvas(); // Already called by renderEditor
        renderEditor(); // Call again to ensure disabled state is correct
    }

    // Set initial tool state visually
    handleToolSelect('pen'); // Activate pen tool by default
    lineWidthDisplay.textContent = currentLineWidth.padStart(2, ' ');
    colorPicker.value = currentColor; // Ensure picker matches state

    console.log("SuperNotes Initialized Successfully.");
}

// Start the app once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', init);

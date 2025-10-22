// Global variables
let allPlayersData = {};
let selectedSquadIds = [];
let usedChips = {
    benchBoost: false,
    tripleCaptain: false,
    wildcard: false
};

document.addEventListener('DOMContentLoaded', () => {
    loadAllPlayers();
    // The 'Analyze Squad' button listener is now the primary action
    document.getElementById('analyze-button').addEventListener('click', analyzeTeam);
    
    setupChipEventListeners();

    // Global click listener to close search results
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            document.querySelectorAll('.search-results').forEach(el => el.style.display = 'none');
        }
    });
});

function setupChipEventListeners() {
    document.getElementById('bench-boost-used').addEventListener('change', (e) => {
        usedChips.benchBoost = e.target.checked;
        saveChipStatusToStorage();
    });
    document.getElementById('triple-captain-used').addEventListener('change', (e) => {
        usedChips.tripleCaptain = e.target.checked;
        saveChipStatusToStorage();
    });
    document.getElementById('wildcard-used').addEventListener('change', (e) => {
        usedChips.wildcard = e.target.checked;
        saveChipStatusToStorage();
    });
}

async function loadAllPlayers() {
    const pitchLoading = document.getElementById('pitch-loading');
    const lineupSetter = document.getElementById('lineup-setter');
    try {
        console.log("Attempting to fetch all players from /api/players...");
        const response = await fetch('/api/players');
        if (!response.ok) {
            throw new Error('Failed to load player data from the server.');
        }
        allPlayersData = await response.json();
        console.log("Successfully fetched and parsed player data.");

        // Hide loading spinner and show the pitch/browser view
        pitchLoading.classList.add('d-none');
        lineupSetter.style.opacity = 1;

        // Load a saved squad from storage, if it exists
        loadSquadFromStorage();
        loadChipStatusFromStorage();
        initializePitchView(); // Initialize pitch view based on loaded squad (or empty)

        validateLineup(); // Call validateLineup once after all initial setup is complete
    } catch (error) {
        console.error("Failed to load players:", error);
        document.getElementById('pitch-column').innerHTML = `<div class="alert alert-danger">Error: Could not load player list. Please try refreshing the page.</div>`;
        document.getElementById('right-column').innerHTML = `<div class="alert alert-danger">Error: Could not load player list. Please try refreshing the page.</div>`;
    }
}

function createPlayerImageHTML(player, size = 'sm') {
    if (!player) return '';

    const containerClass = size === 'lg' ? 'player-image-container-lg' : 'player-image-container';
    const faceClass = size === 'lg' ? 'player-face-lg' : 'player-face';
    const logoClass = 'club-logo-overlay';

    return `
        <div class="${containerClass}">
            <img src="${player.face_url}" class="${faceClass}" alt="${player.name}" onerror="this.onerror=null;this.src='https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';">
            <img src="${player.club_logo_url}" class="${logoClass}" alt="${player.team} logo">
        </div>
    `;
}

function saveSquadToStorage() {
    localStorage.setItem('fpl_squad', JSON.stringify(selectedSquadIds));
}

function saveChipStatusToStorage() {
    localStorage.setItem('fpl_used_chips', JSON.stringify(usedChips));
}

function loadSquadFromStorage() {
    const savedSquadIds = JSON.parse(localStorage.getItem('fpl_squad') || '[]');
    if (savedSquadIds.length > 0) {
        console.log("Loading saved squad from localStorage.");
        const allPlayersFlat = [].concat(...Object.values(allPlayersData.players));

        savedSquadIds.forEach(playerId => {
            const player = allPlayersFlat.find(p => p.id === playerId);
            if (player) {
                // Just populate the ID array. initializePitchView will handle rendering.
                if (!selectedSquadIds.includes(player.id)) {
                    selectedSquadIds.push(player.id);
                }
            }
        });
    }
}

function loadChipStatusFromStorage() {
    const savedChips = JSON.parse(localStorage.getItem('fpl_used_chips') || '{}');
    usedChips = { ...usedChips, ...savedChips };

    // Update checkboxes
    document.getElementById('bench-boost-used').checked = usedChips.benchBoost;
    document.getElementById('triple-captain-used').checked = usedChips.tripleCaptain;
    document.getElementById('wildcard-used').checked = usedChips.wildcard;
}
function initializePitchView() {
    // Define the initial layout of empty slots
    const layout = {
        'gkp-area': 1, 'def-area': 4, 'mid-area': 4, 'fwd-area': 2, // 11 starters
        'bench-area': 4 // 4 subs
    };

    // 1. Clear all pitch and bench areas first
    for (const areaId in layout) {
        document.getElementById(areaId).innerHTML = '';
    }

    // Get all selected player objects
    let selectedPlayers = [];
    if (selectedSquadIds.length > 0) {
        const allPlayersFlat = [].concat(...Object.values(allPlayersData.players));
        selectedPlayers = selectedSquadIds.map(id => {
            const player = allPlayersFlat.find(p => p.id === id);
            if (!player) return null;
            const position = Object.keys(allPlayersData.players).find(posId => allPlayersData.players[posId].some(p => p.id === id));
            const teamData = allPlayersData.teams.find(t => t.id === player.team_id);
            return { ...player, position: parseInt(position), team_code: teamData ? teamData.code : null };
        }).filter(Boolean); // Filter out any nulls if a player wasn't found
    }
    
    // Default starting XI formation (1-4-4-2)
    const starters = new Set();
    const posCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const starterLimits = { 1: 1, 2: 4, 3: 4, 4: 2 }; // Corrected default formation limits
    
    // Sort players by position to apply default starters (e.g., GKP first, then DEF, etc.)
    selectedPlayers.sort((a, b) => a.position - b.position);

    // Keep track of how many players are actually placed in each area
    const placedPlayersCount = {
        'gkp-area': 0, 'def-area': 0, 'mid-area': 0, 'fwd-area': 0, 'bench-area': 0
    };

    // 2. Place actual players first
    selectedPlayers.forEach(player => {
        let isStarter = false;
        // Try to assign as starter if position limit not reached
        if (posCounts[player.position] < starterLimits[player.position]) {
            starters.add(player.id);
            posCounts[player.position]++;
            isStarter = true;
        }

        const playerEl = createPitchPlayerElement(player, isStarter);
        let areaId;
        if (isStarter) {
            areaId = { 1: 'gkp-area', 2: 'def-area', 3: 'mid-area', 4: 'fwd-area' }[player.position];
        } else {
            areaId = 'bench-area';
        }
        document.getElementById(areaId).appendChild(playerEl);
        placedPlayersCount[areaId]++;
    });

    // 3. Fill remaining empty slots
    for (const areaId in layout) {
        const area = document.getElementById(areaId);
        const playersInArea = placedPlayersCount[areaId];
        const emptySlotsToAdd = layout[areaId] - playersInArea;

        for (let i = 0; i < emptySlotsToAdd; i++) {
            area.appendChild(createEmptySlot());
        }
    }
    // --- Captaincy Logic ---
    const starterIds = Array.from(starters);
    let savedCaptainId = localStorage.getItem('fpl_captain');
    let savedViceCaptainId = localStorage.getItem('fpl_vice_captain');

    // Check if the saved captains are still in the current squad
    if (!selectedSquadIds.includes(parseInt(savedCaptainId))) {
        savedCaptainId = null;
    }
    if (!selectedSquadIds.includes(parseInt(savedViceCaptainId))) {
        savedViceCaptainId = null;
    }

    // If no captain is saved or the saved one is not in the squad, set a default
    if (!savedCaptainId && starterIds.length > 0) {
        savedCaptainId = starterIds[0];
        localStorage.setItem('fpl_captain', savedCaptainId);
    }

    // If no vice-captain is saved or the saved one is not in the squad, set a default
    if (!savedViceCaptainId && starterIds.length > 1) {
        // Ensure vice-captain is not the same as captain
        savedViceCaptainId = starterIds[1] == savedCaptainId ? (starterIds[2] || null) : starterIds[1];
        if (savedViceCaptainId) localStorage.setItem('fpl_vice_captain', savedViceCaptainId);
    }

    // Apply the saved/default selections to the radio buttons
    if (savedCaptainId) {
        const capRadio = document.querySelector(`input[name="captain"][value="${savedCaptainId}"]`);
        if (capRadio) capRadio.checked = true;
    }
    if (savedViceCaptainId) {
        const vcRadio = document.querySelector(`input[name="vice_captain"][value="${savedViceCaptainId}"]`);
        if (vcRadio) vcRadio.checked = true;
    }

    // Populate and set up the new player browser
    populatePlayerBrowser();
    document.getElementById('player-browser-search').addEventListener('input', filterPlayerBrowser);
    document.getElementById('player-browser-pos-filter').addEventListener('change', filterPlayerBrowser);
    document.getElementById('player-browser-price-filter').addEventListener('input', filterPlayerBrowser);
} 

function createEmptySlot() {
    const emptySlotTemplate = document.getElementById('empty-slot-template');
    const emptySlot = emptySlotTemplate.content.cloneNode(true).firstElementChild;
    emptySlot.addEventListener('click', () => highlightEmptySlot(emptySlot));
    return emptySlot;
}


function createPitchPlayerElement(player, isStarter) {
    const playerDiv = document.createElement('div');
    playerDiv.className = `pitch-player ${isStarter ? '' : 'benched'}`;
    playerDiv.id = `pitch-player-${player.id}`;
    playerDiv.dataset.playerId = player.id;
    playerDiv.dataset.position = player.position;

    const shirtUrl = player.team_code ? `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${player.team_code}-110.png` : '';

    playerDiv.innerHTML = `
        <div class="player-kit">
            <div class="remove-player-btn"><i class="fas fa-times"></i></div>
            <img src="${shirtUrl}" class="player-shirt" alt="${player.team} shirt" onerror="this.style.display='none'">
            <span class="player-action-button remove-from-pitch-btn" title="Move to Bench">&times;</span>
            <span class="player-action-button add-to-pitch-btn" title="Move to Pitch">+</span>
            <img src="${player.face_url}" class="player-face-overlay" alt="${player.name}" onerror="this.onerror=null;this.src='https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';">
            <div class="captaincy-badge" style="display: none;"></div>
        </div>
        <div class="player-name-plate">${player.name}</div>
        <div class="captaincy-controls mt-1" style="display: none;">
            <label class="captaincy-label" title="Set Captain">
                <input class="captaincy-radio" type="radio" name="captain" value="${player.id}"> C
            </label>
            <label class="captaincy-label" title="Set Vice-Captain">
                <input class="captaincy-radio" type="radio" name="vice_captain" value="${player.id}"> V
            </label>
        </div>
    `;

    playerDiv.querySelector('.remove-player-btn').addEventListener('click', () => removePlayerFromTeam(player.id));
    playerDiv.querySelector('.remove-from-pitch-btn').addEventListener('click', () => movePlayerToBench(player.id));
    playerDiv.querySelector('.add-to-pitch-btn').addEventListener('click', () => movePlayerToPitch(player.id));

    return playerDiv;
}

function placePlayerElement(playerEl, position, isStarter) {
    let areaId;
    if (isStarter) {
        areaId = { 1: 'gkp-area', 2: 'def-area', 3: 'mid-area', 4: 'fwd-area' }[position];
    } else {
        areaId = 'bench-area';
    }
    document.getElementById(areaId).appendChild(playerEl);
}

function movePlayerToBench(playerId) {
    const playerEl = document.getElementById(`pitch-player-${playerId}`);
    if (playerEl) {
        playerEl.classList.add('benched');
        document.getElementById('bench-area').appendChild(playerEl);
        validateLineup();
    }
}

function movePlayerToPitch(playerId) {
    const playerEl = document.getElementById(`pitch-player-${playerId}`);
    if (playerEl) {
        placePlayerElement(playerEl, playerEl.dataset.position, true);
        playerEl.classList.remove('benched');
        validateLineup();
    }
}

function removePlayerFromTeam(playerId) {
    const playerEl = document.getElementById(`pitch-player-${playerId}`);
    if (!playerEl) return;

    // Replace the player element with an empty slot
    const emptySlotTemplate = document.getElementById('empty-slot-template');
    const emptySlot = emptySlotTemplate.content.cloneNode(true).firstElementChild;
    emptySlot.dataset.position = playerEl.dataset.position;
    emptySlot.addEventListener('click', () => highlightEmptySlot(emptySlot));
    playerEl.parentNode.replaceChild(emptySlot, playerEl);

    // Update the global squad list
    selectedSquadIds = selectedSquadIds.filter(id => id !== parseInt(playerId));

    // Refresh the browser to re-enable the removed player
    filterPlayerBrowser();
    saveSquadToStorage();
    validateLineup();
}

function addPlayerToTeam(player) {
    const activeSlot = document.querySelector('.empty-slot.active-slot');
    if (!activeSlot) {
        alert("Please click a '+' slot on the pitch or bench to add a player.");
        return;
    }

    // Create and add the new player element
    const teamData = allPlayersData.teams.find(t => t.id === player.team_id);
    const playerWithDetails = { ...player, position: parseInt(player.position_id), team_code: teamData ? teamData.code : null };
    const newPlayerEl = createPitchPlayerElement(playerWithDetails, !activeSlot.parentNode.id.includes('bench'));
    activeSlot.parentNode.replaceChild(newPlayerEl, activeSlot);

    // Update global state
    selectedSquadIds.push(player.id);
    filterPlayerBrowser(); // Re-filter to disable the newly added player
    saveSquadToStorage();
    validateLineup();
}

function highlightEmptySlot(slotElement) {
    // Remove active class from any other slot
    document.querySelectorAll('.empty-slot.active-slot').forEach(s => s.classList.remove('active-slot'));
    // Add active class to the clicked slot
    slotElement.classList.add('active-slot');
}

function populatePlayerBrowser() {
    const browserList = document.getElementById('player-browser-list');
    browserList.innerHTML = '';
    const allPlayersFlat = [].concat(...Object.values(allPlayersData.players));
    allPlayersFlat.sort((a, b) => b.price - a.price); // Sort by price descending initially

    allPlayersFlat.forEach(player => {
        const item = document.createElement('a');
        item.href = '#';
        item.className = 'list-group-item list-group-item-action browser-player-item';
        item.dataset.playerId = player.id;
        item.dataset.playerName = player.name.toLowerCase();
        item.dataset.playerPosition = Object.keys(allPlayersData.players).find(posId => allPlayersData.players[posId].some(p => p.id === player.id));
        item.dataset.playerPrice = player.price;
        player.position_id = item.dataset.playerPosition; // Store for later

        item.innerHTML = `
            <div class="d-flex w-100 justify-content-between">
                <h6 class="mb-1 small">${player.name} <span class="text-muted">(${player.team})</span></h6>
                <small class="fw-bold">£${player.price.toFixed(1)}m</small>
            </div>
        `;
        item.addEventListener('click', (e) => {
            e.preventDefault();
            if (!item.classList.contains('disabled')) {
                addPlayerToTeam(player);
            }
        });
        browserList.appendChild(item);
    });

    filterPlayerBrowser();
}

function filterPlayerBrowser() {
    const searchTerm = document.getElementById('player-browser-search').value.toLowerCase();
    const posFilter = document.getElementById('player-browser-pos-filter').value;
    const priceFilter = parseFloat(document.getElementById('player-browser-price-filter').value) || 999;

    document.querySelectorAll('.browser-player-item').forEach(item => {
        const isSelected = selectedSquadIds.includes(parseInt(item.dataset.playerId));
        const nameMatch = item.dataset.playerName.includes(searchTerm);
        const posMatch = posFilter === 'all' || item.dataset.playerPosition === posFilter;
        const priceMatch = parseFloat(item.dataset.playerPrice) <= priceFilter;

        item.style.display = (nameMatch && posMatch && priceMatch) ? '' : 'none';
        item.classList.toggle('disabled', isSelected);
    });
}

function validateLineup() {
    const starters = document.querySelectorAll('.pitch-player:not(.benched):not(.empty-slot)');
    const totalPlayers = document.querySelectorAll('.pitch-player:not(.empty-slot)');
    const starterCount = starters.length; // Correctly count only players on the pitch
    document.getElementById('starter-count').textContent = starterCount;

    const analyzeButton = document.getElementById('analyze-button');

    const captainElement = document.querySelector('input[name="captain"]:checked');
    const viceCaptainElement = document.querySelector('input[name="vice_captain"]:checked');

    // Save captain and vice-captain selection to local storage
    if (captainElement) localStorage.setItem('fpl_captain', captainElement.value);
    localStorage.setItem('fpl_vice_captain', viceCaptainElement?.value || '');

    // Update budget info in the browser column
    const allPlayersFlat = [].concat(...Object.values(allPlayersData.players));
    let totalCost = 0;
    selectedSquadIds.forEach(id => {
        const player = allPlayersFlat.find(p => p.id === id);
        if (player) totalCost += player.price;
    });
    document.getElementById('browser-total-cost').textContent = `£${totalCost.toFixed(1)}`;
    const remainingBudget = 100.0 - totalCost;
    const remainingBudgetElement = document.getElementById('browser-remaining-budget');
    remainingBudgetElement.textContent = `£${remainingBudget.toFixed(1)}`;
    remainingBudgetElement.classList.remove('text-danger', 'text-success');
    if (remainingBudget < 0) {
        remainingBudgetElement.classList.add('text-danger');
    } else if (totalCost > 0) {
        remainingBudgetElement.classList.add('text-success');
    }

    const posCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    starters.forEach(s => {
        posCounts[s.dataset.position]++;        
    });

    const lineupError = document.getElementById('lineup-error');
    let errorMessage = '';

    // Initial validation for squad size before allowing analysis
    if (totalPlayers.length !== 15) {
        analyzeButton.disabled = true;
        analyzeButton.textContent = `Select ${15 - totalPlayers.length} more players`;
    } else {
        analyzeButton.textContent = 'Analyze Squad';
        if (starterCount !== 11) {
            errorMessage = 'You must select exactly 11 starters.';
        } else if (posCounts[1] !== 1) {
            errorMessage = 'You must have exactly 1 Goalkeeper in your starting XI.';
        } else if (posCounts[2] < 3 || posCounts[2] > 5) {
            errorMessage = 'You must have 3 to 5 Defenders in your starting XI.';
        } else if (posCounts[3] < 2 || posCounts[3] > 5) {
            errorMessage = 'You must have 2 to 5 Midfielders in your starting XI.';
        } else if (posCounts[4] < 1 || posCounts[4] > 3) {
            errorMessage = 'You must have 1 to 3 Forwards in your starting XI.';
        } else if (!captainElement || !viceCaptainElement) {
            errorMessage = 'You must select a Captain and a Vice-Captain.';
        } else if (captainElement.value === viceCaptainElement.value) {
            errorMessage = 'Captain and Vice-Captain cannot be the same player.';
        } else if (document.getElementById(`pitch-player-${captainElement.value}`)?.classList.contains('benched') || document.getElementById(`pitch-player-${viceCaptainElement.value}`)?.classList.contains('benched')) {
            errorMessage = 'Captain and Vice-Captain must be in your starting XI.';
        }
    } // End of totalPlayers.length === 15 check

    // Update captaincy UI
    document.querySelectorAll('.captaincy-badge').forEach(b => b.style.display = 'none');
    document.querySelectorAll('.captaincy-controls').forEach(c => c.style.display = 'none');
    starters.forEach(s => {
        const controls = s.querySelector('.captaincy-controls');
        if (controls) controls.style.display = 'block';
        const capRadio = controls.querySelector('input[name="captain"]');
        const vcRadio = controls.querySelector('input[name="vice_captain"]');
        if (capRadio && captainElement) capRadio.checked = (capRadio.value === captainElement.value);
        if (vcRadio && viceCaptainElement) vcRadio.checked = (vcRadio.value === viceCaptainElement.value);
    });
    if (captainElement) {
        const badge = document.querySelector(`#pitch-player-${captainElement.value} .captaincy-badge`);
        if(badge) { badge.textContent = 'C'; badge.style.display = 'flex'; }
    }
    if (viceCaptainElement) {
        const badge = document.querySelector(`#pitch-player-${viceCaptainElement.value} .captaincy-badge`);
        if(badge) { badge.textContent = 'V'; badge.style.display = 'flex'; }
    }

    if (errorMessage) {
        lineupError.textContent = errorMessage;
        lineupError.classList.remove('d-none');
        analyzeButton.disabled = true;
    } else {
        lineupError.classList.add('d-none');
        // Only enable if 15 players are selected AND lineup is valid
        analyzeButton.disabled = (totalPlayers.length !== 15);
    }
    
    // Add event listeners to new radio buttons
    document.querySelectorAll('.captaincy-radio').forEach(rb => rb.addEventListener('change', validateLineup));
}


async function analyzeTeam() {
    const startingPlayerElements = document.querySelectorAll('.pitch-player:not(.benched)');
    const benchPlayerElements = document.querySelectorAll('.pitch-player.benched');
    const captainId = document.querySelector('input[name="captain"]:checked')?.value;
    const viceCaptainId = document.querySelector('input[name="vice_captain"]:checked')?.value;
    
    const starting_ids = Array.from(startingPlayerElements).map(el => parseInt(el.dataset.playerId));
    const bench_ids = Array.from(benchPlayerElements).map(el => parseInt(el.dataset.playerId));

    // Safeguard: Ensure captain and vice-captain are selected before analysis
    if (!captainId || !viceCaptainId) {
        const errorDiv = document.getElementById('error-container');
        errorDiv.querySelector('#error').textContent = 'Error: Captain and Vice-Captain must be selected.';
        errorDiv.classList.remove('d-none');
        // Hide loading if it was shown, and ensure results are hidden
        document.getElementById('loading').classList.add('d-none');
        document.getElementById('results').classList.add('d-none');
        return;
    }

    // Get references to UI elements
    const loadingDiv = document.getElementById('loading');
    const resultsDiv = document.getElementById('results');
    const errorDiv = document.getElementById('error-container');

    // Reset UI
    loadingDiv.classList.remove('d-none');
    resultsDiv.classList.add('d-none');
    errorDiv.classList.add('d-none');
    document.getElementById('transfer-suggestions-section').classList.add('d-none');
    window.scrollTo({ top: loadingDiv.offsetTop - 20, behavior: 'smooth' });

    try {
        const response = await fetch('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                starting_ids,
                bench_ids,
                captain_id: parseInt(captainId),
                vice_captain_id: parseInt(viceCaptainId), // Added vice_captain_id
                usedChips // Corrected from used_chips to usedChips
            }),
        });

        let data;
        loadingDiv.classList.add('d-none');

        if (!response.ok) {
            const rawErrorText = await response.text(); // Read body ONCE as text
            let errorMessage = `Server error (${response.status}): `; 
            try {
                const errorData = JSON.parse(rawErrorText); // Try to parse the text as JSON
                errorMessage += errorData.error || 'An unknown error occurred on the server.';
            } catch (e) {
                // If parsing as JSON fails, it's likely HTML or plain text
                errorMessage += `Received non-JSON response. Content: ${rawErrorText.substring(0, 200)}... (full error in console)`;
                console.error("Raw server error response:", rawErrorText);
            }
            throw new Error(errorMessage);
        }
        // If response is OK, then parse as JSON
        data = await response.json();
        displayResults(data);
        resultsDiv.classList.remove('d-none');

    } catch (error) {
        console.error("Analysis failed:", error);
        loadingDiv.classList.add('d-none');
        errorDiv.querySelector('#error').textContent = `Error: ${error.message}`;
        errorDiv.classList.remove('d-none');
        // Ensure the error container is visible
        errorDiv.classList.remove('d-none');
    }
}

function displayResults(data) {
    // Display Rating
    document.getElementById('team-rating').textContent = `${data.team_rating} / 100`;

    const transferSuggestionsSection = document.getElementById('transfer-suggestions-section');

    // --- Free Transfers and Other Suggestions Logic ---
    const freeTransfersContainer = document.getElementById('free-transfers-container');
    const otherSuggestionsContainer = document.getElementById('other-suggestions-container');

    // Clear previous results
    freeTransfersContainer.innerHTML = '';
    otherSuggestionsContainer.innerHTML = '';

    transferSuggestionsSection.classList.remove('d-none');

    // Render Free Transfers
    if (data.free_transfers && data.free_transfers.length > 0) {
        data.free_transfers.forEach(suggestion => {
            freeTransfersContainer.appendChild(createSuggestionChatBubble(suggestion));
        });
    } else {
        freeTransfersContainer.innerHTML = '<div class="chat-bubble assistant"><p class="mb-0">Looks like you have a solid team! No high-value free transfers found for this gameweek.</p></div>';
    }

    // Render Other Suggestions
    if (data.other_suggestions && data.other_suggestions.length > 0) {
        data.other_suggestions.forEach(suggestion => {
            otherSuggestionsContainer.appendChild(createSuggestionChatBubble(suggestion, false));
        });
    } else {
        otherSuggestionsContainer.innerHTML = '<div class="col-12"><p class="text-muted">No other potential upgrades found.</p></div>';
    }

    // --- Chip Suggestions Logic ---
    const chipSuggestionsSection = document.getElementById('chip-suggestions-section');
    const chipSuggestionsContainer = document.getElementById('chip-suggestions-container');
    chipSuggestionsContainer.innerHTML = '';

    if (data.chip_suggestions && data.chip_suggestions.length > 0) {
        chipSuggestionsSection.classList.remove('d-none');
        data.chip_suggestions.forEach(chip => {
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble assistant';
            
            const headerDiv = document.createElement('div');
            headerDiv.className = 'd-flex w-100 justify-content-between';
            const h6 = document.createElement('h6');
            h6.className = 'mb-1 chip-name';
            h6.textContent = `Consider the ${chip.chip} chip!`;
            headerDiv.appendChild(h6);
            bubble.appendChild(headerDiv);

            const p = document.createElement('p');
            p.className = 'mb-1 small';
            p.innerHTML = chip.reason; // Assuming chip.reason can contain HTML
            bubble.appendChild(p);

            chipSuggestionsContainer.appendChild(bubble);
        });
    }

    // --- Suggested Lineups (Tabs) Logic ---
    const suggestedLineupsSection = document.getElementById('suggested-lineups-section');
    const ftContainer = document.getElementById('suggested-lineup-table-ft').querySelector('tbody');
    const wcContainer = document.getElementById('suggested-lineup-table-wc').querySelector('tbody');
    const wcTabItem = document.getElementById('wildcard-tab-item');

    ftContainer.innerHTML = '';
    wcContainer.innerHTML = '';
    suggestedLineupsSection.classList.add('d-none');
    wcTabItem.style.display = 'none';

    // Populate Free Transfer Lineup
    if (data.suggested_lineup_ft && data.suggested_lineup_ft.length > 0) {
        suggestedLineupsSection.classList.remove('d-none');
        data.suggested_lineup_ft.forEach(player => {
            ftContainer.appendChild(createLineupRow(player));
        });
    }

    // Populate Wildcard Lineup if it exists
    if (data.suggested_lineup_wc && data.suggested_lineup_wc.length > 0) {
        suggestedLineupsSection.classList.remove('d-none');
        wcTabItem.style.display = 'block'; // Show the tab
        data.suggested_lineup_wc.forEach(player => {
            wcContainer.appendChild(createLineupRow(player));
        });
    } else {
        // If no wildcard lineup, ensure the free transfers tab is active
        const ftTab = new bootstrap.Tab(document.getElementById('free-transfers-tab'));
        ftTab.show();
    }

    // --- New Gameweek Fixtures Logic ---
    renderFixtures(data);
}

function createSuggestionChatBubble(suggestion, isFreeTransfer = true) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'd-flex w-100 justify-content-between';
    const h6 = document.createElement('h6');
    h6.className = 'mb-1 chip-name';
    h6.textContent = isFreeTransfer ? 'Top Free Transfer' : 'Potential Upgrade';
    headerDiv.appendChild(h6);
    bubble.appendChild(headerDiv);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'd-flex justify-content-around align-items-center text-center flex-grow-1 mt-2';
    contentDiv.innerHTML = `
        <div class="suggestion-player">
            ${createPlayerImageHTML({ face_url: suggestion.out_face_url, club_logo_url: suggestion.out_club_logo_url, name: suggestion.out, team: '' }, 'lg')}
            <p class="mb-0 small"><strong>OUT</strong></p>
            <p class="small text-muted mb-0">${suggestion.out}</p>
        </div>
        <div class="swap-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" class="bi bi-arrow-left-right" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M1 11.5a.5.5 0 0 0 .5.5h11.793l-3.147 3.146a.5.5 0 0 0 .708.708l4-4a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 11H1.5a.5.5 0 0 0-.5.5m14-7a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 1 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 4H14.5a.5.5 0 0 1 .5.5"/>
            </svg>
        </div>
        <div class="suggestion-player">
            ${createPlayerImageHTML({ face_url: suggestion.in_face_url, club_logo_url: suggestion.in_club_logo_url, name: suggestion.in, team: '' }, 'lg')}
            <p class="mb-0 small"><strong>IN</strong></p>
            <p class="small text-muted mb-0">${suggestion.in}</p>
        </div>
    `;
    bubble.appendChild(contentDiv);

    const reasonP = document.createElement('p');
    reasonP.className = 'mb-1 small mt-3 text-center';
    reasonP.innerHTML = suggestion.reason;
    bubble.appendChild(reasonP);

    return bubble;
}

/* Removed unused function createSuggestionCard
    const col = document.createElement('div');
    col.className = 'col-lg-6 col-md-12';
    col.innerHTML = `
        <div class="card h-100 suggestion-card">
            <div class="card-body d-flex flex-column">
                <div class="d-flex justify-content-around align-items-center text-center flex-grow-1">
                    <div class="suggestion-player">
                        ${createPlayerImageHTML({ face_url: suggestion.out_face_url, club_logo_url: suggestion.out_club_logo_url, name: suggestion.out, team: '' }, 'lg')}
                        <p class="mb-0 small"><strong>OUT</strong></p>
                        <p class="small text-muted mb-0">${suggestion.out}</p>
                    </div>
                    <div class="swap-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" class="bi bi-arrow-left-right" viewBox="0 0 16 16">
                            <path fill-rule="evenodd" d="M1 11.5a.5.5 0 0 0 .5.5h11.793l-3.147 3.146a.5.5 0 0 0 .708.708l4-4a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 11H1.5a.5.5 0 0 0-.5.5m14-7a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 1 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 4H14.5a.5.5 0 0 1 .5.5"/>
                        </svg>
                    </div>
                    <div class="suggestion-player">
                        ${createPlayerImageHTML({ face_url: suggestion.in_face_url, club_logo_url: suggestion.in_club_logo_url, name: suggestion.in, team: '' }, 'lg')}
                        <p class="mb-0 small"><strong>IN</strong></p>
                        <p class="small text-muted mb-0">${suggestion.in}</p>
                    </div>
                </div>
                <p class="card-text text-muted small fst-italic mt-3 text-center mb-0">${suggestion.reason}</p>
    `;
    return col;
} */

function createLineupRow(player) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><span class="badge ${player.role.includes('Captain') ? 'bg-danger' : (player.role === 'Starter' ? 'bg-success' : 'bg-secondary')}">${player.role}</span></td>
        <td>${player.name} ${
            player.role === 'Captain' ? '(C)' :
            player.role === 'Vice-Captain' ? '(VC)' :
            ''
        }</td>
        <td>${player.form}</td>
        <td>£${player.price.toFixed(1)}m</td>
        <td>${player.points}</td>
    `;
    return row;
}

function renderFixtures(data) {
    const fixturesSection = document.getElementById('gameweek-fixtures-section');
    const fixturesContainer = document.getElementById('fixtures-container');
    fixturesContainer.innerHTML = '';

    if (!data.gameweek_fixtures || data.gameweek_fixtures.length === 0) return;

    document.getElementById('results').classList.remove('d-none');
    fixturesSection.classList.remove('d-none');
    const allPlayersFlat = [].concat(...Object.values(allPlayersData.players));
    const squadPlayers = selectedSquadIds.map(id => allPlayersFlat.find(p => p.id === id)).filter(Boolean);

    data.gameweek_fixtures.forEach(fixture => {
        const homePlayers = squadPlayers.filter(p => p.team_id === fixture.home_team_id);
        const awayPlayers = squadPlayers.filter(p => p.team_id === fixture.away_team_id);

        // Only render the fixture if the user has players in it
        if (homePlayers.length === 0 && awayPlayers.length === 0) {
            return;
        }

        const playerImageContainerHTML = (player) => `
            <div class="player-image-container">
                <img src="${player.face_url}" class="player-face" alt="${player.name}" onerror="this.onerror=null;this.src='https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';">
                <img src="${player.club_logo_url}" class="club-logo-overlay" alt="${player.team} logo">
            </div>
        `;

        const col = document.createElement('div');
        col.className = 'col-md-12';
        const homePlayersHTML = homePlayers.map(p => `
            <div class="player-in-fixture" title="${p.name}">
                ${playerImageContainerHTML(p)}
                <span>${p.name}</span>
            </div>
        `).join('');

        const awayPlayersHTML = awayPlayers.map(p => `
            <div class="player-in-fixture" title="${p.name}">
                ${playerImageContainerHTML(p)}
                <span>${p.name}</span>
            </div>
        `).join('');

        col.innerHTML = `
            <div class="card h-100">
                <div class="card-body">
                    <div class="d-flex justify-content-between text-center">
                        <div class="fixture-team"><h6>${fixture.home_team_name}</h6>${homePlayersHTML}</div>
                        <div class="fixture-separator">vs</div>
                        <div class="fixture-team"><h6>${fixture.away_team_name}</h6>${awayPlayersHTML}</div>
                    </div>
                </div>
            </div>
        `;
        fixturesContainer.appendChild(col);
    });
}

// Dynamically add styles for player image containers if not already present in CSS
const styleSheet = document.createElement("style");
styleSheet.innerText = `
    .player-image-container {
        position: relative;
        width: 30px;
        height: 30px;
    }
    .player-face {
        width: 100%; height: 100%; border-radius: 50%; object-fit: cover; background-color: var(--neutral-200);
    }
`;
document.head.appendChild(styleSheet);
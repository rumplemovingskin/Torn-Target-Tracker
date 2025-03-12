// Torn Target Tracker
// Main script file

// Constants
const TORN_API_URL = 'https://api.torn.com';
const TORN_PROFILE_URL = 'https://www.torn.com/profiles.php?XID=';
const STORAGE_KEY_API = 'torn_tracker_api_key';
const STORAGE_KEY_TARGETS = 'torn_tracker_targets';
const STORAGE_KEY_SETTINGS = 'torn_tracker_settings';
const UPDATE_INTERVAL = 60000; // Update targets every 60 seconds
const CHAIN_WARNING_TIME = 300000; // 5 minutes chain warning
const API_RATE_LIMIT = 100; // Maximum 100 requests per minute
const API_WINDOW_SIZE = 60000; // 1 minute in milliseconds

// DOM Elements - globally define to make sure they're initialized properly
let apiKeyInput, saveApiKeyBtn, apiStatus, apiRateDisplay, targetIdInput, addTargetBtn, targetsList, 
    noTargetsMessage, filterStatus, filterSort, toggleAlerts, currentChainEl, 
    chainCooldownEl, updateChainBtn, targetTemplate, tabButtons, tabContents, 
    importAttacksBtn, importStatusEl, exportDataBtn, importDataBtn, clearDataBtn,
    energyBarEl, energyTextEl, nerveBarEl, nerveTextEl, drugCooldownEl, boosterCooldownEl;

// Sound Elements
let soundTargetOnline, soundChainWarning, soundOpportunity;

// State
let apiKey = localStorage.getItem(STORAGE_KEY_API) || '';
let targets = JSON.parse(localStorage.getItem(STORAGE_KEY_TARGETS) || '[]');
let settings = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || '{"alerts": false, "lastUpdate": 0}');
let updateTimer = null;
let chainTimer = null;
let cooldownTimer = null;
let rateLimitTimer = null;
let apiRequestLog = []; // Tracks timestamps of API requests
let currentUpdateRate = 0; // Current update rate to display
let chainData = {
    current: 0,
    timeout: 0
};
let playerStatus = {
    energy: { current: 0, maximum: 100 },
    nerve: { current: 0, maximum: 100 },
    cooldowns: {
        drug: 0,
        booster: 0
    }
};

// Initialize all DOM references
function initDOMReferences() {
    apiKeyInput = document.getElementById('api-key');
    saveApiKeyBtn = document.getElementById('save-api-key');
    apiStatus = document.getElementById('api-status');
    apiRateDisplay = document.getElementById('api-rate-display');
    targetIdInput = document.getElementById('target-id');
    addTargetBtn = document.getElementById('add-target');
    targetsList = document.getElementById('targets-list');
    noTargetsMessage = document.getElementById('no-targets-message');
    filterStatus = document.getElementById('filter-status');
    filterSort = document.getElementById('filter-sort');
    toggleAlerts = document.getElementById('toggle-alerts');
    currentChainEl = document.getElementById('current-chain');
    chainCooldownEl = document.getElementById('chain-cooldown');
    updateChainBtn = document.getElementById('update-chain');
    targetTemplate = document.getElementById('target-template');
    tabButtons = document.querySelectorAll('.tab-btn');
    tabContents = document.querySelectorAll('.tab-content');
    importAttacksBtn = document.getElementById('import-attacks');
    importStatusEl = document.getElementById('import-status');
    exportDataBtn = document.getElementById('export-data');
    importDataBtn = document.getElementById('import-data');
    clearDataBtn = document.getElementById('clear-data');

    // Player Status Elements
    energyBarEl = document.getElementById('energy-bar');
    energyTextEl = document.getElementById('energy-text');
    nerveBarEl = document.getElementById('nerve-bar');
    nerveTextEl = document.getElementById('nerve-text');
    drugCooldownEl = document.getElementById('drug-cooldown');
    boosterCooldownEl = document.getElementById('booster-cooldown');
    
    // Sound Elements
    soundTargetOnline = document.getElementById('sound-target-online');
    soundChainWarning = document.getElementById('sound-chain-warning');
    soundOpportunity = document.getElementById('sound-opportunity');
}

// Initialize the application
function init() {
    // Initialize DOM references first
    initDOMReferences();
    
    if (apiKey) {
        if (apiKeyInput) apiKeyInput.value = '••••••••••••••••••••••••••';
        if (apiStatus) apiStatus.textContent = 'Checking connection...';
        validateApiKey();
    }

    if (toggleAlerts) toggleAlerts.checked = settings.alerts;
    
    // Set up event listeners - only if elements exist
    if (saveApiKeyBtn) saveApiKeyBtn.addEventListener('click', handleSaveApiKey);
    if (addTargetBtn) addTargetBtn.addEventListener('click', handleAddTarget);
    if (filterStatus) filterStatus.addEventListener('change', renderTargets);
    if (filterSort) filterStatus.addEventListener('change', renderTargets);
    if (toggleAlerts) toggleAlerts.addEventListener('change', handleToggleAlerts);
    if (updateChainBtn) {
        updateChainBtn.addEventListener('click', () => {
            updateChainStatus();
            updatePlayerStatus();
        });
    }
    
    // Tab navigation
    if (tabButtons) {
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Deactivate all tabs
                tabButtons.forEach(btn => btn.classList.remove('active'));
                if (tabContents) {
                    tabContents.forEach(content => content.classList.remove('active'));
                }
                
                // Activate the clicked tab
                button.classList.add('active');
                const tabId = button.dataset.tab;
                
                // Find and activate the corresponding tab content
                const tabContent = document.getElementById(`${tabId}-tab`);
                if (tabContent) {
                    tabContent.classList.add('active');
                } else {
                    console.error(`Tab content not found: ${tabId}-tab`);
                }
            });
        });
    }
    
    // Settings panel buttons
    if (importAttacksBtn) importAttacksBtn.addEventListener('click', importFromAttackHistory);
    if (exportDataBtn) exportDataBtn.addEventListener('click', exportData);
    if (importDataBtn) importDataBtn.addEventListener('click', importData);
    if (clearDataBtn) clearDataBtn.addEventListener('click', clearAllData);
    
    // Initialize bars with zero values
    if (energyBarEl) energyBarEl.style.width = '0%';
    if (nerveBarEl) nerveBarEl.style.width = '0%';
    
    // Render initial targets
    renderTargets();
    
    // Start rate display timer
    startRateDisplayTimer();
    
    // Start update timer if we have an API key
    if (apiKey) {
        startUpdateTimer();
    }
}

// Add a function to track API requests
function trackApiRequest() {
    const now = Date.now();
    
    // Add the current timestamp to the log
    apiRequestLog.push(now);
    
    // Remove requests older than the API window (1 minute)
    apiRequestLog = apiRequestLog.filter(timestamp => now - timestamp < API_WINDOW_SIZE);
    
    // Update the current rate display
    updateRateDisplay();
    
    // Return the current number of requests in the window
    return apiRequestLog.length;
}

// Add a function to update the rate display
function updateRateDisplay() {
    const currentRate = apiRequestLog.length;
    
    // Only update the DOM if the element exists
    if (apiRateDisplay) {
        apiRateDisplay.textContent = `${currentRate}/${API_RATE_LIMIT} req/min`;
        
        // Color-code based on usage
        if (currentRate > API_RATE_LIMIT * 0.9) {
            apiRateDisplay.style.color = 'var(--danger-color)';
        } else if (currentRate > API_RATE_LIMIT * 0.7) {
            apiRateDisplay.style.color = 'var(--warning-color)';
        } else {
            apiRateDisplay.style.color = 'var(--text-secondary)';
        }
    }
    
    // Store current rate for use in calculations
    currentUpdateRate = currentRate;
}

// Start a timer to continuously update the rate display
function startRateDisplayTimer() {
    if (rateLimitTimer) clearInterval(rateLimitTimer);
    
    rateLimitTimer = setInterval(() => {
        // Update the display by clearing out expired requests
        const now = Date.now();
        apiRequestLog = apiRequestLog.filter(timestamp => now - timestamp < API_WINDOW_SIZE);
        updateRateDisplay();
    }, 5000); // Update every 5 seconds
}

async function fetchFromTornApi(endpoint, selections = '') {
    if (!apiKey) {
        console.error("API key is missing!");
        return null;
    }

    if (!endpoint || typeof endpoint !== 'string') {
        console.error("Invalid endpoint:", endpoint);
        return null;
    }

    const url = `${TORN_API_URL}/${endpoint}?selections=${selections}&key=${apiKey}`;
    console.log(`Fetching from API: ${url}`); // Log the full request URL

    try {
        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            console.log('API Error details:', data.error); // Log actual error response
            throw new Error(data.error.error);
        }

        return data;
    } catch (error) {
        console.error('API Fetch Error:', error);
        return null;
    }
}


async function validateApiKey() {
    const userData = await fetchFromTornApi('user', 'basic');
    
    if (userData && apiStatus) {
        apiStatus.textContent = `Connected as ${userData.name} [${userData.player_id}]`;
        apiStatus.style.color = 'var(--success-color)';
        return true;
    }
    
    return false;
}

async function fetchPlayerData(playerId) {
    if (!playerId || isNaN(playerId)) {
        console.error("Invalid Player ID:", playerId);
        return null;
    }
    return await fetchFromTornApi(`user/${playerId}`, 'profile,personalstats,basic');
}

async function updateChainStatus() {
    console.log("Checking faction chain status...");

    // First, check if user is in a faction before making the request
    const userData = await fetchFromTornApi('user', 'basic');

    if (!userData || !userData.faction || userData.faction.faction_id === 0) {
        console.warn("User is not in a faction, skipping chain update.");
        return;
    }

    const factionData = await fetchFromTornApi('faction', 'chain');

    if (!factionData || !factionData.chain) {
        console.error("Failed to retrieve faction chain data.");
        return;
    }

    chainData.current = factionData.chain.current;
    chainData.timeout = factionData.chain.timeout;

    currentChainEl.textContent = chainData.current;
    updateChainCooldownTimer();
}


async function updatePlayerStatus() {
    if (!apiKey) return;
    
    try {
        // Make sure DOM elements exist
        if (!energyBarEl || !energyTextEl || !nerveBarEl || !nerveTextEl || 
            !drugCooldownEl || !boosterCooldownEl) {
            console.error('Player status DOM elements not found');
            return;
        }
        
        // Get player data from API (bars and cooldowns)
        const userData = await fetchFromTornApi('user', 'bars,cooldowns');
        
        if (userData) {
            console.log('Player data (bars):', userData); // Debug
            
            // Update energy
            if (userData.energy) {
                playerStatus.energy.current = userData.energy.current;
                playerStatus.energy.maximum = userData.energy.maximum;
                
                const energyPercent = (userData.energy.current / userData.energy.maximum) * 100;
                energyBarEl.style.width = `${energyPercent}%`;
                energyTextEl.textContent = `${userData.energy.current}/${userData.energy.maximum}`;
            } else {
                console.warn('No energy data returned from API');
            }
            
            // Update nerve
            if (userData.nerve) {
                playerStatus.nerve.current = userData.nerve.current;
                playerStatus.nerve.maximum = userData.nerve.maximum;
                
                const nervePercent = (userData.nerve.current / userData.nerve.maximum) * 100;
                nerveBarEl.style.width = `${nervePercent}%`;
                nerveTextEl.textContent = `${userData.nerve.current}/${userData.nerve.maximum}`;
            } else {
                console.warn('No nerve data returned from API');
            }
            
            // Update cooldowns
            if (userData.cooldowns) {
                playerStatus.cooldowns.drug = userData.cooldowns.drug || 0;
                playerStatus.cooldowns.booster = userData.cooldowns.booster || 0;
                
                // Start cooldown timers
                updateCooldownTimers();
            } else {
                console.warn('No cooldown data returned from API');
            }
            
            if (apiStatus) {
                apiStatus.textContent = 'Connected';
                apiStatus.style.color = 'var(--success-color)';
            }
        }
    } catch (error) {
        console.error('Error updating player status:', error);
        if (apiStatus) {
            apiStatus.textContent = `Error: ${error.message}`;
            apiStatus.style.color = 'var(--danger-color)';
        }
    }
}

function updateCooldownTimers() {
    if (cooldownTimer) clearInterval(cooldownTimer);
    
    function updateDisplay() {
        const now = Math.floor(Date.now() / 1000);
        
        // Update drug cooldown
        const drugTimeRemaining = Math.max(0, playerStatus.cooldowns.drug - now);
        if (drugCooldownEl) {
            drugCooldownEl.textContent = formatTimeRemaining(drugTimeRemaining);
        }
        
        // Update booster cooldown
        const boosterTimeRemaining = Math.max(0, playerStatus.cooldowns.booster - now);
        if (boosterCooldownEl) {
            boosterCooldownEl.textContent = formatTimeRemaining(boosterTimeRemaining);
        }
    }
    
    // Initial update
    updateDisplay();
    
    // Update every second
    cooldownTimer = setInterval(updateDisplay, 1000);
}

// Target Management
async function addTarget(playerId) {
    // Check if target already exists
    if (targets.some(target => target.id === playerId)) {
        alert(`Target ${playerId} is already in your list.`);
        return;
    }
    
    const playerData = await fetchPlayerData(playerId);
    
    if (!playerData) {
        alert(`Couldn't retrieve data for player ${playerId}.`);
        return;
    }
    
    console.log('Player data:', playerData); // Debug
    
    // Safely extract nested properties with fallbacks
    const newTarget = {
        id: playerId,
        name: playerData.name || `Unknown ${playerId}`,
        level: playerData.level || 0,
        favorite: false, // Initialize as not favorited
        faction: {
            id: playerData.faction ? playerData.faction.faction_id || 0 : 0,
            name: playerData.faction ? playerData.faction.faction_name || 'None' : 'None'
        },
        status: {
            state: playerData.status ? playerData.status.state || 'Unknown' : 'Unknown',
            lastAction: playerData.last_action ? playerData.last_action.relative || 'Unknown' : 'Unknown',
            lastActionTimestamp: playerData.last_action ? playerData.last_action.timestamp || 0 : 0
        },
        age: playerData.age || 0,
        awards: playerData.awards || 0,
        stats: {
            attacks: 0,
            wins: 0,
            moneyMugged: 0,
            lastUpdated: Date.now()
        }
    };
    
    targets.push(newTarget);
    saveTargets();
    renderTargets();
}

function updateTarget(targetId, newData) {
    const targetIndex = targets.findIndex(target => target.id === targetId);
    
    if (targetIndex === -1) return;
    
    // Track state changes for alerts
    const oldState = targets[targetIndex].status.state;
    const newState = newData.status.state;
    
    // Preserve favorite status
    const favorite = targets[targetIndex].favorite;
    
    // Update the target with new data but keep stats and favorite status
    targets[targetIndex] = {
        ...targets[targetIndex],
        ...newData,
        favorite: favorite // Keep favorite status
    };
    
    // Handle alerts for state changes 
    if (settings.alerts && oldState !== newState) {
        // If a hospitalized target leaves hospital
        if (oldState === 'Hospital' && newState !== 'Hospital') {
            if (soundOpportunity) soundOpportunity.play();
            showNotification(`${targets[targetIndex].name} has left the hospital!`, 'target-opportunity');
        }
        
        // If an offline target comes online
        if ((oldState === 'Offline' || oldState === 'Idle') && newState === 'Online') {
            if (soundTargetOnline) soundTargetOnline.play();
            showNotification(`${targets[targetIndex].name} is now online!`, 'target-online');
        }
    }
    
    saveTargets();
}

function removeTarget(targetId) {
    if (confirm(`Are you sure you want to remove ${targetId} from your targets?`)) {
        targets = targets.filter(target => target.id !== targetId);
        saveTargets();
        renderTargets();
    }
}

// Toggle favorite status for a target
function toggleFavorite(targetId) {
    const targetIndex = targets.findIndex(target => target.id === targetId);
    
    if (targetIndex === -1) return;
    
    // Toggle favorite status
    targets[targetIndex].favorite = !targets[targetIndex].favorite;
    
    saveTargets();
    renderTargets();
}

// Add attack data from a completed attack
function recordAttackResult(targetId, success, respect = 0, moneyMugged = 0) {
    const targetIndex = targets.findIndex(target => target.id === targetId);
    
    if (targetIndex === -1) return;
    
    const target = targets[targetIndex];
    target.stats.attacks++;
    
    if (success) {
        target.stats.wins++;
        target.stats.moneyMugged += moneyMugged;
    }
    
    target.stats.lastUpdated = Date.now();
    saveTargets();
    renderTargets();
}

// Rendering
function renderTargets() {
    // Make sure targetsList exists
    if (!targetsList) {
        console.error('targetsList element not found');
        return;
    }
    
    targetsList.innerHTML = '';
    
    // Apply filters
    let filteredTargets = [...targets];
    
    // Status filter
    const statusFilter = filterStatus ? filterStatus.value : 'all';
    if (statusFilter !== 'all') {
        filteredTargets = filteredTargets.filter(target => {
            const status = target.status.state.toLowerCase();
            return status === statusFilter.toLowerCase();
        });
    }
    
    // Apply sorting - favorites first, then selected sort
    const sortBy = filterSort ? filterSort.value : 'level-desc';
    filteredTargets.sort((a, b) => {
        // First sort by favorite status
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        
        // Then sort by the selected criteria
        switch (sortBy) {
            case 'level-asc':
                return a.level - b.level;
            case 'level-desc':
                return b.level - a.level;
            case 'last-action':
                return b.status.lastActionTimestamp - a.status.lastActionTimestamp;
            case 'money-mugged':
                return b.stats.moneyMugged - a.stats.moneyMugged;
            case 'success-rate':
                const rateA = a.stats.attacks > 0 ? a.stats.wins / a.stats.attacks : 0;
                const rateB = b.stats.attacks > 0 ? b.stats.wins / b.stats.attacks : 0;
                return rateB - rateA;
            default:
                return 0;
        }
    });
    
    // Show or hide the "no targets" message
    if (noTargetsMessage) {
        if (targets.length === 0) {
            noTargetsMessage.style.display = 'block';
        } else {
            noTargetsMessage.style.display = 'none';
        }
    }
    
    // Make sure targetTemplate exists
    if (!targetTemplate) {
        console.error('targetTemplate element not found');
        return;
    }
    
    // Render each target
    filteredTargets.forEach(target => {
        try {
            const targetRow = targetTemplate.content.cloneNode(true);
            
            // Find name element and set text content
            const nameElement = targetRow.querySelector('.name');
            if (nameElement) {
                nameElement.textContent = target.name;
                if (target.favorite) {
                    nameElement.classList.add('favorite');
                    nameElement.textContent = "★ " + target.name;
                }
            }
            
            // Set ID
            const idElement = targetRow.querySelector('.id');
            if (idElement) idElement.textContent = target.id;
            
            // Set level
            const levelElement = targetRow.querySelector('.level');
            if (levelElement) levelElement.textContent = target.level;
            
            // Set status
            const statusElem = targetRow.querySelector('.status');
            if (statusElem) {
                statusElem.textContent = target.status.state;
                statusElem.classList.add(target.status.state.toLowerCase().replace(/\s+/g, '-'));
            }
            
            // Set other fields
            const factionNameEl = targetRow.querySelector('.faction-name');
            if (factionNameEl) factionNameEl.textContent = target.faction.name || 'None';
            
            const lastActionEl = targetRow.querySelector('.last-action');
            if (lastActionEl) lastActionEl.textContent = target.status.lastAction;
            
            const ageEl = targetRow.querySelector('.age');
            if (ageEl) ageEl.textContent = target.age;
            
            const awardsEl = targetRow.querySelector('.awards');
            if (awardsEl) awardsEl.textContent = target.awards;
            
            // Attack stats
            const attacksEl = targetRow.querySelector('.attacks');
            if (attacksEl) attacksEl.textContent = target.stats.attacks;
            
            const successRateEl = targetRow.querySelector('.success-rate');
            if (successRateEl) {
                const successRate = target.stats.attacks > 0 
                    ? Math.round((target.stats.wins / target.stats.attacks) * 100) 
                    : 0;
                successRateEl.textContent = `${successRate}%`;
            }
            
            const moneyMuggedEl = targetRow.querySelector('.money-mugged');
            if (moneyMuggedEl) moneyMuggedEl.textContent = formatMoney(target.stats.moneyMugged);
            
            // Set up buttons
            const attackBtn = targetRow.querySelector('.btn-attack');
            if (attackBtn) {
                attackBtn.addEventListener('click', () => {
                    window.open(`https://www.torn.com/loader.php?sid=attack&user2ID=${target.id}`, '_blank');
                });
            }
            
            const profileBtn = targetRow.querySelector('.btn-profile');
            if (profileBtn) {
                profileBtn.addEventListener('click', () => {
                    window.open(`${TORN_PROFILE_URL}${target.id}`, '_blank');
                });
            }
            
            const favoriteBtn = targetRow.querySelector('.btn-favorite');
            if (favoriteBtn) {
                favoriteBtn.textContent = target.favorite ? 'Unfavorite' : 'Favorite';
                favoriteBtn.addEventListener('click', () => toggleFavorite(target.id));
            }
            
            const removeBtn = targetRow.querySelector('.btn-remove');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => removeTarget(target.id));
            }
            
            targetsList.appendChild(targetRow);
        } catch (error) {
            console.error(`Error rendering target ${target.id}:`, error);
        }
    });
}

// Event Handlers
async function handleSaveApiKey() {
    if (!apiKeyInput) return;
    
    const newApiKey = apiKeyInput.value;
    
    if (!newApiKey) {
        alert('Please enter a valid API key.');
        return;
    }
    
    apiKey = newApiKey;
    if (apiStatus) apiStatus.textContent = 'Checking connection...';
    
    const isValid = await validateApiKey();
    
    if (isValid) {
        localStorage.setItem(STORAGE_KEY_API, apiKey);
        apiKeyInput.value = '••••••••••••••••••••••••••';
        startUpdateTimer();
        updateChainStatus();
    } else {
        apiKey = '';
        localStorage.removeItem(STORAGE_KEY_API);
    }
}

async function handleAddTarget() {
    if (!targetIdInput) return;
    
    const targetId = targetIdInput.value.trim();
    
    if (!targetId) {
        alert('Please enter a valid target ID.');
        return;
    }
    
    if (!apiKey) {
        alert('Please enter your API key first.');
        return;
    }
    
    targetIdInput.value = '';
    await addTarget(targetId);
}

function handleToggleAlerts() {
    if (!toggleAlerts) return;
    
    settings.alerts = toggleAlerts.checked;
    saveSettings();
    
    if (settings.alerts && soundTargetOnline) {
        // Play a test sound
        soundTargetOnline.volume = 0.2;
        soundTargetOnline.play();
    }
}

// Utility Functions
function formatMoney(amount) {
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatTimeRemaining(seconds) {
    if (seconds <= 0) return '00:00:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    return [hours, minutes, remainingSeconds]
        .map(v => v.toString().padStart(2, '0'))
        .join(':');
}

function showNotification(message, type) {
    // Just use console log for now, don't request browser notifications
    console.log(`NOTIFICATION: ${type} - ${message}`);
    
    // Create a temporary on-screen notification
    const notification = document.createElement('div');
    notification.className = 'app-notification';
    notification.textContent = message;
    
    // Add appropriate class based on type
    if (type === 'target-online') {
        notification.classList.add('notification-online');
    } else if (type === 'target-opportunity') {
        notification.classList.add('notification-opportunity');
    } else if (type === 'chain-warning') {
        notification.classList.add('notification-warning');
    }
    
    document.body.appendChild(notification);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 500);
    }, 5000);
}

// Timer Functions
function startUpdateTimer() {
    if (updateTimer) clearInterval(updateTimer);
    
    // Initial update
    updateAllTargets();
    updatePlayerStatus();
    updateChainStatus();
    
    // Set interval for future updates
    updateTimer = setInterval(() => {
        updateAllTargets();
        updatePlayerStatus();
        updateChainStatus();
    }, UPDATE_INTERVAL);
}

function updateChainCooldownTimer() {
    if (chainTimer) clearInterval(chainTimer);
    
    if (!chainCooldownEl) {
        console.error('Chain cooldown element not found');
        return;
    }
    
    function updateDisplay() {
        const now = Math.floor(Date.now() / 1000);
        const timeRemaining = Math.max(0, chainData.timeout - now);
        
        chainCooldownEl.textContent = formatTimeRemaining(timeRemaining);
        
        // Apply warning class if chain is about to expire
        if (timeRemaining <= CHAIN_WARNING_TIME / 1000 && timeRemaining > 0) {
            chainCooldownEl.style.color = 'var(--warning-color)';
            
            // Play sound if alerts are enabled and under 5 minutes
            if (settings.alerts && timeRemaining === Math.floor(CHAIN_WARNING_TIME / 1000)) {
                if (soundChainWarning) soundChainWarning.play();
                showNotification('Chain expiring soon!', 'chain-warning');
            }
        } else if (timeRemaining === 0) {
            chainCooldownEl.style.color = 'var(--danger-color)';
        } else {
            chainCooldownEl.style.color = 'var(--text-primary)';
        }
    }
    
    // Initial update
    updateDisplay();
    
    // Update every second
    chainTimer = setInterval(updateDisplay, 1000);
}

// Data management
async function updateAllTargets() {
    if (!apiKey) return;
    
    if (apiStatus) apiStatus.textContent = 'Updating...';
    
    // Calculate a safe batch size based on API usage
    // Leave room for other API calls (player status, chain)
    const safeRequestsPerMinute = API_RATE_LIMIT - 5; // Leave 5 requests for other calls
    const currentRequests = currentUpdateRate;
    const availableRequests = Math.max(0, safeRequestsPerMinute - currentRequests);
    
    // If we don't have enough available requests, only update a portion of targets
    let targetsToUpdate = targets;
    if (availableRequests < targets.length) {
        // Determine how many targets we can safely update
        const batchSize = Math.max(1, Math.floor(availableRequests));
        console.log(`Rate limiting: Updating only ${batchSize}/${targets.length} targets`);
        
        // Select a rotation of targets to update
        const startIndex = (Math.floor(Date.now() / 30000)) % targets.length; // Rotate every 30 seconds
        targetsToUpdate = [];
        
        for (let i = 0; i < batchSize; i++) {
            const index = (startIndex + i) % targets.length;
            targetsToUpdate.push(targets[index]);
        }
    }
    
    for (const target of targetsToUpdate) {
        try {
            const playerData = await fetchPlayerData(target.id);
            
            if (playerData) {
                const updatedData = {
                    name: playerData.name || target.name,
                    level: playerData.level || target.level,
                    faction: {
                        id: playerData.faction ? playerData.faction.faction_id || target.faction.id : target.faction.id,
                        name: playerData.faction ? playerData.faction.faction_name || target.faction.name : target.faction.name
                    },
                    status: {
                        state: playerData.status ? playerData.status.state || target.status.state : target.status.state,
                        lastAction: playerData.last_action ? playerData.last_action.relative || target.status.lastAction : target.status.lastAction,
                        lastActionTimestamp: playerData.last_action ? playerData.last_action.timestamp || target.status.lastActionTimestamp : target.status.lastActionTimestamp
                    },
                    age: playerData.age || target.age,
                    awards: playerData.awards || target.awards
                };
                
                updateTarget(target.id, updatedData);
            }
        } catch (error) {
            console.error(`Error updating target ${target.id}:`, error);
        }
        
        // Dynamic delay based on our current rate
        const baseDelay = 300; // Base delay in ms
        const rateFactor = Math.max(0.2, Math.min(5, currentUpdateRate / (API_RATE_LIMIT * 0.7))); 
        const delay = Math.floor(baseDelay * rateFactor);
        
        // Small delay to avoid hitting API rate limits
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    settings.lastUpdate = Date.now();
    saveSettings();
    renderTargets();
    
    const lastUpdateTime = new Date(settings.lastUpdate).toLocaleTimeString();
    if (apiStatus) {
        apiStatus.textContent = `Connected - Updated: ${lastUpdateTime}`;
        apiStatus.style.color = 'var(--success-color)';
    }
}

// Storage functions
function saveTargets() {
    localStorage.setItem(STORAGE_KEY_TARGETS, JSON.stringify(targets));
}

function saveSettings() {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
}

// New Functions for Settings Tab

// Import targets from attack history
async function importFromAttackHistory() {
    if (!apiKey) {
        alert('Please enter your API key first.');
        return;
    }

    if (importStatusEl) importStatusEl.textContent = 'Importing targets...';

    try {
        // Get the player's own ID to filter out their own attacks
        const userData = await fetchFromTornApi('user', 'basic');
        const myId = userData ? userData.player_id : null;
        if (!myId) {
            throw new Error('Failed to retrieve your player ID.');
        }

        // Fetch attack history
        const attacksData = await fetchFromTornApi('user', 'attacks');

        if (!attacksData || !attacksData.attacks) {
            throw new Error('Failed to retrieve attack history.');
        }

        console.log('Attacks data:', attacksData); // Debugging

        // 🔎 Filter out successful attacks **where you were the attacker**
        const successfulAttacks = Object.entries(attacksData.attacks)
    		.filter(([_, attack]) => {
        		console.log(`🔎 Attack result: ${attack.result} | Attacker: ${attack.attacker_id} | Defender: ${attack.defender_id}`);
		
        		// Ensure YOU were the attacker
        		if (attack.attacker_id !== myId) {
            			return false; // Skip if you were NOT the attacker
        		}
	
        		// Convert result to lowercase to avoid case mismatches
        		const result = String(attack.result || '').trim().toLowerCase();
		
        		// Include all attack outcomes where you successfully won
        		return result.includes('mugged') || 
               			result.includes('hospitalized') || 
               			result.includes('arrested') ||
               			result.includes('attacked') ||  
               			result.includes('leave') ||     
               			attack.respect_gain > 0;        
    		})
    		.map(([_, attack]) => attack.defender_id) // Extract defender ID (the enemy)
    		.filter(id => id !== myId); // ❌ Exclude yourself just in case

	console.log('Successful attack targets:', successfulAttacks);

        // Check if it’s empty
        if (successfulAttacks.length === 0) {
            if (importStatusEl) importStatusEl.textContent = 'No valid targets found.';
            return;
        }

        // Remove duplicates
        const uniqueTargetIds = [...new Set(successfulAttacks)];

        // Add targets to the list
        let importedCount = 0;
        for (const targetId of uniqueTargetIds) {
            if (targets.some(target => target.id === targetId.toString())) {
                console.log(`Skipping existing target: ${targetId}`);
                continue;
            }

            try {
                console.log(`Fetching data for target ${targetId}...`);
                const playerData = await fetchPlayerData(targetId.toString());

                if (playerData) {
                    const newTarget = {
                        id: targetId.toString(),
                        name: playerData.name || `Unknown ${targetId}`,
                        level: playerData.level || 0,
                        favorite: false,
                        faction: {
                            id: playerData.faction ? playerData.faction.faction_id || 0 : 0,
                            name: playerData.faction ? playerData.faction.faction_name || 'None' : 'None'
                        },
                        status: {
                            state: playerData.status ? playerData.status.state || 'Unknown' : 'Unknown',
                            lastAction: playerData.last_action ? playerData.last_action.relative || 'Unknown' : 'Unknown',
                            lastActionTimestamp: playerData.last_action ? playerData.last_action.timestamp || 0 : 0
                        },
                        age: playerData.age || 0,
                        awards: playerData.awards || 0,
                        stats: {
                            attacks: 0,
                            wins: 0,
                            moneyMugged: 0,
                            lastUpdated: Date.now()
                        }
                    };

                    targets.push(newTarget);
                    saveTargets();
                    renderTargets(); // Update UI
                    importedCount++;
                }
            } catch (error) {
                console.error(`❌ Error importing target ${targetId}:`, error);
            }
        }

        let statusMsg = `Successfully imported ${importedCount} new targets.`;
        if (importStatusEl) importStatusEl.textContent = statusMsg;

        setTimeout(() => {
            if (importStatusEl) importStatusEl.textContent = '';
        }, 5000);

    } catch (error) {
        console.error('Import error:', error);
        if (importStatusEl) importStatusEl.textContent = `Error: ${error.message}`;
    }
}


// Export all data to JSON file
function exportData() {
    const exportData = {
        targets: targets,
        settings: settings
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = 'torn_targets_backup.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

// Import data from JSON file
function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = e => {
        const file = e.target.files[0];
        
        if (!file) return;
        
        const reader = new FileReader();
        reader.readAsText(file, 'UTF-8');
        
        reader.onload = readerEvent => {
            try {
                const content = readerEvent.target.result;
                const parsedData = JSON.parse(content);
                
                if (parsedData.targets && Array.isArray(parsedData.targets)) {
                    targets = parsedData.targets;
                    saveTargets();
                }
                
                if (parsedData.settings) {
                    settings = parsedData.settings;
                    saveSettings();
                    if (toggleAlerts) toggleAlerts.checked = settings.alerts;
                }
                
                renderTargets();
                alert('Data imported successfully!');
            } catch (error) {
                console.error('Import error:', error);
                alert('Error importing data. Please check the file format.');
            }
        };
    };
    
    input.click();
}

// Clear all data
function clearAllData() {
    if (confirm('Are you sure you want to clear all target data? This cannot be undone!')) {
        targets = [];
        saveTargets();
        renderTargets();
        alert('All target data has been cleared.');
    }
}

// Add app notifications (replaces browser notifications)
function createAppNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = 'app-notification';
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Auto-remove after a few seconds
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 500);
    }, 5000);
}

// Check if DOM elements exist before using them
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app');
    // Initialize app with proper DOM handling
    init();
});

// Request notification permissions on page load - DISABLED
// if ('Notification' in window) {
//     if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
//         Notification.requestPermission();
//     }
// }
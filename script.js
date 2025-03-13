// Torn Target Tracker
// Main script file

// Constants
const TORN_API_URL = 'https://api.torn.com';
const TORN_PROFILE_URL = 'https://www.torn.com/profiles.php?XID=';
const STORAGE_KEY_API = 'torn_tracker_api_key';
const STORAGE_KEY_TARGETS = 'torn_tracker_targets';
const STORAGE_KEY_SETTINGS = 'torn_tracker_settings';
const STORAGE_KEY_NOTIFICATIONS = 'torn_tracker_notifications';
const UPDATE_INTERVAL_TARGETS = 30000; // Check targets every 30 seconds (changed from 15)
const UPDATE_INTERVAL_USER = 15000; // Update user status every 30 seconds (changed from 15)
const CHAIN_WARNING_TIME = 60000; // 1 minute chain warning
const API_RATE_LIMIT = 100; // Maximum 100 requests per minute
const API_WINDOW_SIZE = 60000; // 1 minute in milliseconds
const MAX_NOTIFICATIONS = 50; // Maximum number of notifications to store

// DOM Elements - globally define to make sure they're initialized properly
let apiKeyInput, saveApiKeyBtn, apiStatus, apiRateDisplay, targetIdInput, addTargetBtn, targetsList, 
    noTargetsMessage, filterStatus, filterSort, toggleAlerts, currentChainEl, 
    chainCooldownEl, updateChainBtn, targetTemplate, tabButtons, tabContents, 
    importAttacksBtn, importStatusEl, exportDataBtn, importDataBtn, clearDataBtn,
    energyBarEl, energyTextEl, nerveBarEl, nerveTextEl, drugCooldownEl, boosterCooldownEl,
    notificationsList, clearNotificationsBtn;

// Sound Elements
let soundTargetOnline, soundChainWarning, soundOpportunity;

// State
let apiKey = localStorage.getItem(STORAGE_KEY_API) || '';
let targets = JSON.parse(localStorage.getItem(STORAGE_KEY_TARGETS) || '[]');
let settings = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || '{"alerts": false, "lastUpdate": 0}');
let notifications = JSON.parse(localStorage.getItem(STORAGE_KEY_NOTIFICATIONS) || '[]');
let updateTimer = null;
let userUpdateTimer = null;
let chainTimer = null;
let cooldownTimer = null;
let rateLimitTimer = null;
let apiRequestLog = []; // Tracks timestamps of API requests
let currentUpdateRate = 0; // Current update rate to display
let targetUpdateQueue = []; // Queue for target updates
let isUpdating = false; // Flag to prevent multiple concurrent updates
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
    notificationsList = document.getElementById('notifications-list');
    clearNotificationsBtn = document.getElementById('clear-notifications');

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
    if (filterSort) filterSort.addEventListener('change', renderTargets);
    if (toggleAlerts) toggleAlerts.addEventListener('change', handleToggleAlerts);
    if (updateChainBtn) {
        updateChainBtn.addEventListener('click', () => {
            updateChainStatus();
            updatePlayerStatus();
        });
    }
    if (clearNotificationsBtn) {
        clearNotificationsBtn.addEventListener('click', clearNotifications);
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
    
    // Render notifications
    renderNotifications();
    
    // Start rate display timer
    startRateDisplayTimer();
    
    // Start update timers if we have an API key
    if (apiKey) {
        startUpdateTimers();
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

    // Track this API request for rate limiting
    trackApiRequest();

    const url = `${TORN_API_URL}/${endpoint}?selections=${selections}&key=${apiKey}`;
    console.log(`Fetching from API: ${endpoint} (selections: ${selections})`);

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
            console.log('API Error details:', data.error);
            throw new Error(data.error.error);
        }

        return data;
    } catch (error) {
        console.error('API Fetch Error:', error);
        if (apiStatus) {
            apiStatus.textContent = `Error: ${error.message}`;
            apiStatus.style.color = 'var(--danger-color)';
        }
        return null;
    }
}

async function checkChainInUserData() {
    try {
        // First try to get chain data directly from the user endpoint
        const userData = await fetchFromTornApi('user', 'bars');
        
        if (userData && userData.chain) {
            console.log("Chain data found directly in user data:", userData.chain);
            return userData.chain;
        } else {
            console.log("No chain data in user bars response");
            return null;
        }
    } catch (error) {
        console.error("Error checking for chain in user data:", error);
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

    try {
        // First, try to get chain data directly from the user endpoint
        const chainFromUser = await checkChainInUserData();
        
        if (chainFromUser) {
            // Update chain data from user endpoint
            chainData.current = chainFromUser.current;
            chainData.timeout = chainFromUser.timeout;
            
            if (currentChainEl) currentChainEl.textContent = chainData.current;
            updateChainCooldownTimer();
            return;
        }
        
        // If we can't get chain data directly, try to get faction ID
        const userData = await fetchFromTornApi('user', 'profile');
        console.log("User profile data for faction check:", userData);
        
        if (!userData) {
            console.warn("Failed to retrieve user data");
            return;
        }
        
        // Check for faction info in different possible locations
        let factionId = null;
        
        if (userData.faction && userData.faction.faction_id) {
            factionId = userData.faction.faction_id;
        } else if (userData.faction_id) {
            factionId = userData.faction_id;
        } else {
            console.warn("No faction information found in user data");
            return;
        }
        
        if (!factionId || factionId === 0) {
            console.warn("User is not in a faction, skipping chain update.");
            return;
        }
        
        console.log(`Fetching faction data for faction ID: ${factionId}`);
        
        // Now that we have the faction ID, fetch the chain data
        const factionData = await fetchFromTornApi(`faction/${factionId}`, 'chain');

        if (!factionData || !factionData.chain) {
            console.error("Failed to retrieve faction chain data.");
            return;
        }

        console.log("Chain data received:", factionData.chain);
        
        // Update chain data
        chainData.current = factionData.chain.current;
        chainData.timeout = factionData.chain.timeout;

        if (currentChainEl) currentChainEl.textContent = chainData.current;
        updateChainCooldownTimer();
    } catch (error) {
        console.error("Error updating chain status:", error);
    }
}

// Update the player status function to also update chain data if available
async function updatePlayerStatus() {
    if (!apiKey) return;
    
    try {
        // Make sure DOM elements exist
        if (!energyBarEl || !energyTextEl || !nerveBarEl || !nerveTextEl || 
            !drugCooldownEl || !boosterCooldownEl) {
            console.error('Player status DOM elements not found');
            return;
        }
        
        // Get bars and cooldowns data
        const userData = await fetchFromTornApi('user', 'bars,cooldowns');
        
        if (userData) {
            console.log('Player data received:', userData);
            
            // Update energy
            if (userData.energy) {
                playerStatus.energy.current = userData.energy.current;
                playerStatus.energy.maximum = userData.energy.maximum;
                
                const energyPercent = (userData.energy.current / userData.energy.maximum) * 100;
                energyBarEl.style.width = `${energyPercent}%`;
                energyTextEl.textContent = `${userData.energy.current}/${userData.energy.maximum}`;
            }
            
            // Update nerve
            if (userData.nerve) {
                playerStatus.nerve.current = userData.nerve.current;
                playerStatus.nerve.maximum = userData.nerve.maximum;
                
                const nervePercent = (userData.nerve.current / userData.nerve.maximum) * 100;
                nerveBarEl.style.width = `${nervePercent}%`;
                nerveTextEl.textContent = `${userData.nerve.current}/${userData.nerve.maximum}`;
            }
            
            // If chain data is available directly in user data, update it
            if (userData.chain) {
                console.log('Chain data from player status:', userData.chain);
                
                // For chain data, we need to ensure the timeout is an actual timestamp, not a relative time
                if (userData.chain.timeout && userData.server_time) {
                    // If timeout is small (like 49), it's probably seconds remaining, not a timestamp
                    if (userData.chain.timeout < 1000) {
                        // Convert to absolute timestamp by adding to server time
                        chainData.timeout = userData.server_time + userData.chain.timeout;
                        console.log(`Converted chain timeout from relative (${userData.chain.timeout}s) to absolute: ${chainData.timeout}`);
                    } else {
                        chainData.timeout = userData.chain.timeout;
                    }
                } else {
                    chainData.timeout = 0;
                }
                
                chainData.current = userData.chain.current;
                
                if (currentChainEl) currentChainEl.textContent = chainData.current;
                updateChainCooldownTimer();
            }
            
            // Update cooldowns - we need to handle the possibility that these are relative times
            if (userData.cooldowns) {
                console.log('Cooldown data:', userData.cooldowns);
                
                // Store timestamps as integers
                // Check if these are absolute timestamps or relative times
                if (userData.server_time) {
                    // If the cooldown times are small, they're probably seconds remaining, not timestamps
                    if (userData.cooldowns.drug > 0 && userData.cooldowns.drug < 86400) {
                        // Convert to absolute timestamp
                        playerStatus.cooldowns.drug = userData.server_time + parseInt(userData.cooldowns.drug);
                        console.log(`Converted drug cooldown from relative (${userData.cooldowns.drug}s) to absolute: ${playerStatus.cooldowns.drug}`);
                    } else {
                        playerStatus.cooldowns.drug = parseInt(userData.cooldowns.drug || 0);
                    }
                    
                    if (userData.cooldowns.booster > 0 && userData.cooldowns.booster < 86400) {
                        // Convert to absolute timestamp
                        playerStatus.cooldowns.booster = userData.server_time + parseInt(userData.cooldowns.booster);
                        console.log(`Converted booster cooldown from relative (${userData.cooldowns.booster}s) to absolute: ${playerStatus.cooldowns.booster}`);
                    } else {
                        playerStatus.cooldowns.booster = parseInt(userData.cooldowns.booster || 0);
                    }
                } else {
                    // No server time, just use as-is
                    playerStatus.cooldowns.drug = parseInt(userData.cooldowns.drug || 0);
                    playerStatus.cooldowns.booster = parseInt(userData.cooldowns.booster || 0);
                }
                
                // Start cooldown timers
                updateCooldownTimers();
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
            // Add color indication for active cooldowns
            drugCooldownEl.style.color = drugTimeRemaining > 0 ? 'var(--warning-color)' : 'var(--text-secondary)';
        }
        
        // Update booster cooldown
        const boosterTimeRemaining = Math.max(0, playerStatus.cooldowns.booster - now);
        if (boosterCooldownEl) {
            boosterCooldownEl.textContent = formatTimeRemaining(boosterTimeRemaining);
            // Add color indication for active cooldowns
            boosterCooldownEl.style.color = boosterTimeRemaining > 0 ? 'var(--warning-color)' : 'var(--text-secondary)';
        }
        
        // Only log once every 60 seconds to reduce console spam
        if (now % 60 === 0) {
            console.log('Cooldown timer update:', {
                currentTime: now,
                drugTimestamp: playerStatus.cooldowns.drug,
                drugRemaining: drugTimeRemaining,
                boosterTimestamp: playerStatus.cooldowns.booster,
                boosterRemaining: boosterTimeRemaining,
                formattedDrugTime: formatTimeRemaining(drugTimeRemaining)
            });
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
    
    // Immediately fetch attack stats for this target
    updateTargetAttackStats(playerId);
}

async function updateTargetAttackStats(targetId) {
    // Fetch attack history to update the target's attack stats
    try {
        const attacksData = await fetchFromTornApi('user', 'attacks');
        
        if (!attacksData || !attacksData.attacks) {
            console.warn("No attack data available");
            return;
        }
        
        const targetIndex = targets.findIndex(target => target.id === targetId);
        if (targetIndex === -1) return;
        
        // Get user's own ID to filter attacks properly
        const userData = await fetchFromTornApi('user', 'basic');
        const myId = userData ? userData.player_id.toString() : null;
        
        if (!myId) {
            console.error("Failed to get user's ID");
            return;
        }
        
        // Filter attacks against this target
        const targetAttacks = Object.values(attacksData.attacks).filter(attack => {
            return attack.defender_id.toString() === targetId && attack.attacker_id.toString() === myId;
        });
        
        if (targetAttacks.length === 0) {
            console.log(`No attack history found for target ${targetId}`);
            return;
        }
        
        // Count attacks and successful attacks
        let totalAttacks = targetAttacks.length;
        let wins = 0;
        let totalMugged = 0;
        
        targetAttacks.forEach(attack => {
            const result = String(attack.result || '').toLowerCase();
            // Consider any of these results as a "win"
            if (result.includes('mugged') || 
                result.includes('hospitalized') || 
                result.includes('arrested') ||
                result.includes('attacked') ||
                result.includes('leave') ||
                attack.respect_gain > 0) {
                wins++;
                
                // Add money mugged if available
                if (attack.money_mugged) {
                    totalMugged += attack.money_mugged;
                }
            }
        });
        
        // Update the target's stats
        targets[targetIndex].stats.attacks = totalAttacks;
        targets[targetIndex].stats.wins = wins;
        targets[targetIndex].stats.moneyMugged = totalMugged;
        targets[targetIndex].stats.lastUpdated = Date.now();
        
        saveTargets();
        renderTargets();
        
        console.log(`Updated attack stats for ${targets[targetIndex].name}: ${wins}/${totalAttacks} wins, $${totalMugged} mugged`);
    } catch (error) {
        console.error(`Error updating attack stats for target ${targetId}:`, error);
    }
}

function updateTarget(targetId, newData) {
    const targetIndex = targets.findIndex(target => target.id === targetId);
    
    if (targetIndex === -1) return;
    
    // Track state changes for alerts
    const oldState = targets[targetIndex].status.state;
    const newState = newData.status.state;
    
    // Preserve favorite status and stats
    const favorite = targets[targetIndex].favorite;
    const stats = targets[targetIndex].stats;
    
    // Update the target with new data but keep stats and favorite status
    targets[targetIndex] = {
        ...targets[targetIndex],
        ...newData,
        favorite: favorite, // Keep favorite status
        stats: stats // Keep attack stats
    };
    
    // Handle alerts for state changes 
    if (settings.alerts && oldState !== newState) {
        // If a hospitalized target leaves hospital
        if (oldState === 'Hospital' && newState !== 'Hospital') {
            if (soundOpportunity) soundOpportunity.play();
            const notificationText = `${targets[targetIndex].name} has left the hospital!`;
            addNotification(notificationText, 'target-opportunity');
            showNotification(notificationText, 'target-opportunity');
        }
        
        // If an offline target comes online
        if ((oldState === 'Offline' || oldState === 'Idle') && newState === 'Online') {
            if (soundTargetOnline) soundTargetOnline.play();
            const notificationText = `${targets[targetIndex].name} is now online!`;
            addNotification(notificationText, 'target-online');
            showNotification(notificationText, 'target-online');
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

// Notification system
function addNotification(message, type) {
    const notification = {
        id: Date.now(),
        message,
        type,
        timestamp: new Date().toLocaleString()
    };
    
    // Add to the beginning of the array
    notifications.unshift(notification);
    
    // Limit the number of stored notifications
    if (notifications.length > MAX_NOTIFICATIONS) {
        notifications = notifications.slice(0, MAX_NOTIFICATIONS);
    }
    
    // Save to local storage
    localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(notifications));
    
    // Update the UI if the notifications tab is visible
    renderNotifications();
}

function renderNotifications() {
    if (!notificationsList) return;
    
    notificationsList.innerHTML = '';
    
    if (notifications.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'notification-empty';
        emptyMessage.textContent = 'No notifications yet.';
        notificationsList.appendChild(emptyMessage);
        return;
    }
    
    notifications.forEach(notification => {
        const notificationEl = document.createElement('div');
        notificationEl.className = 'notification-item';
        
        // Add appropriate class based on type
        if (notification.type) {
            notificationEl.classList.add(notification.type);
        }
        
        const timeEl = document.createElement('div');
        timeEl.className = 'notification-time';
        timeEl.textContent = notification.timestamp;
        
        const messageEl = document.createElement('div');
        messageEl.className = 'notification-message';
        messageEl.textContent = notification.message;
        
        notificationEl.appendChild(timeEl);
        notificationEl.appendChild(messageEl);
        
        notificationsList.appendChild(notificationEl);
    });
}

function clearNotifications() {
    if (confirm('Are you sure you want to clear all notifications?')) {
        notifications = [];
        localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(notifications));
        renderNotifications();
    }
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
                
                const updateStatsBtn = targetRow.querySelector('.btn-update-stats');
                if (updateStatsBtn) {
                    updateStatsBtn.addEventListener('click', () => updateTargetAttackStats(target.id));
                }
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
        startUpdateTimers();
        updateChainStatus();
        updatePlayerStatus();
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
function startUpdateTimers() {
    // Clear any existing timers
    if (updateTimer) clearInterval(updateTimer);
    if (userUpdateTimer) clearInterval(userUpdateTimer);
    
    // Stagger initial updates to avoid API call bursts
    setTimeout(() => {
        // Initial update of player status and chain
        updatePlayerStatus();
    }, 1000);
    
    setTimeout(() => {
        // Initial update of targets
        updateAllTargets();
    }, 3000);
    
    // Set interval for target updates (rate-limited)
    // Increase the interval to reduce API calls
    updateTimer = setInterval(() => {
        updateAllTargets();
    }, 30000); // Update targets every 30 seconds instead of 15
    
    // Set interval for user and chain status
    // Increase the interval to reduce API calls
    userUpdateTimer = setInterval(() => {
        updatePlayerStatus();
        // No need to explicitly call updateChainStatus() since updatePlayerStatus() will update chain data
    }, 30000); // Update user status every 30 seconds instead of 15
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
        
        // Only log once every 60 seconds to reduce console spam
        if (now % 60 === 0) {
            console.log('Chain timer update:', {
                currentTime: now,
                chainTimeout: chainData.timeout,
                timeRemaining: timeRemaining,
                formattedTime: formatTimeRemaining(timeRemaining)
            });
        }
        
        chainCooldownEl.textContent = formatTimeRemaining(timeRemaining);
        
        // Apply warning class if chain is about to expire
        if (timeRemaining <= CHAIN_WARNING_TIME / 1000 && timeRemaining > 0) {
            chainCooldownEl.style.color = 'var(--warning-color)';
            
            // Play sound if alerts are enabled and under 5 minutes
            if (settings.alerts && timeRemaining === Math.floor(CHAIN_WARNING_TIME / 1000)) {
                if (soundChainWarning) soundChainWarning.play();
                const notificationText = 'Chain expiring soon!';
                addNotification(notificationText, 'chain-warning');
                showNotification(notificationText, 'chain-warning');
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
    if (!apiKey || isUpdating) return;
    
    isUpdating = true;
    
    if (apiStatus) apiStatus.textContent = 'Updating...';
    
    try {
        // Calculate a safe batch size based on API usage
        // Leave room for other API calls (player status, chain)
        const safeRequestsPerMinute = API_RATE_LIMIT - 10; // Leave 10 requests for other calls
        const currentRequests = currentUpdateRate;
        const availableRequests = Math.max(0, safeRequestsPerMinute - currentRequests);
        
        // Prioritize which targets to update
        let prioritizedTargets = [...targets];
        
        // Sort targets: hospitalized first, then by last update time
        prioritizedTargets.sort((a, b) => {
            // Hospitalized targets get priority
            if (a.status.state === 'Hospital' && b.status.state !== 'Hospital') return -1;
            if (a.status.state !== 'Hospital' && b.status.state === 'Hospital') return 1;
            
            // Then sort by last updated time (oldest first)
            const aLastUpdated = a.stats.lastUpdated || 0;
            const bLastUpdated = b.stats.lastUpdated || 0;
            return aLastUpdated - bLastUpdated;
        });
        
        // If we don't have enough available requests, only update a portion of targets
        let targetsToUpdate = prioritizedTargets;
        if (availableRequests < prioritizedTargets.length) {
            // Determine how many targets we can safely update
            const batchSize = Math.max(1, Math.floor(availableRequests));
            console.log(`Rate limiting: Updating only ${batchSize}/${prioritizedTargets.length} targets`);
            targetsToUpdate = prioritizedTargets.slice(0, batchSize);
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
            const baseDelay = 200; // Base delay in ms
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
    } catch (error) {
        console.error('Error updating targets:', error);
        if (apiStatus) {
            apiStatus.textContent = `Error: ${error.message}`;
            apiStatus.style.color = 'var(--danger-color)';
        }
    } finally {
        isUpdating = false;
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

        // Filter out successful attacks where you were the attacker
        const successfulAttacks = Object.entries(attacksData.attacks)
            .filter(([_, attack]) => {
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
            .filter(id => id !== myId); // Exclude yourself just in case

        // Check if it's empty
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
                    
                    // After adding, update the attack stats
                    await updateTargetAttackStats(targetId.toString());
                }
            } catch (error) {
                console.error(`Error importing target ${targetId}:`, error);
            }
            
            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 300));
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
        settings: settings,
        notifications: notifications
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
                
                if (parsedData.notifications && Array.isArray(parsedData.notifications)) {
                    notifications = parsedData.notifications;
                    localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(notifications));
                    renderNotifications();
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
        settings = {"alerts": false, "lastUpdate": 0};
        notifications = [];
        saveTargets();
        saveSettings();
        localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(notifications));
        renderTargets();
        renderNotifications();
        if (toggleAlerts) toggleAlerts.checked = false;
        alert('All data has been cleared.');
    }
}

// Check if DOM elements exist before using them
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app');
    // Initialize app with proper DOM handling
    init();
});
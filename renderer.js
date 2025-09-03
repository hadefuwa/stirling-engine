const { ipcRenderer } = require('electron')

// Constants
let MAX_LOG_ENTRIES = 100;
let MAX_DATA_POINTS = 100;
let MAX_TIME_POINTS = 100;
let SAMPLE_RATE = 1;

// Add settings object
let settings = {
    maxLogEntries: MAX_LOG_ENTRIES,
    maxDataPoints: MAX_DATA_POINTS,
    maxTimePoints: MAX_TIME_POINTS,
    sampleRate: SAMPLE_RATE,
    pressureMin: 0,
    pressureMax: 20000,
    volumeMin: 46000,
    volumeMax: 47000,
    sampleCount: 1
};

// List available ports and auto connect
async function initializeConnection() {
    const ports = await ipcRenderer.invoke('list-ports')
    const portList = document.getElementById('portList')
    
    ports.forEach(port => {
        const option = document.createElement('option')
        option.value = port.path
        option.textContent = `${port.path} - ${port.manufacturer || 'Unknown'}`
        portList.appendChild(option)
    })

    // Auto connect to first available port
    if (ports.length > 0) {
        portList.value = ports[0].path
        connectToPort()
    } else {
        logMessage('SYSTEM', 'No COM ports found')
    }
}

// Command mapping
const COMMANDS = {
    heaterOn: ':B1;\n',
    heaterOff: ':B0;\n',
    startLogging: ':C1;\n',
    stopLogging: ':C0;\n'
}

// Send command function
async function sendCommand(commandType) {
    if (!COMMANDS[commandType]) {
        logMessage('ERROR', 'Invalid command type')
        return
    }

    const command = COMMANDS[commandType]
    const result = await ipcRenderer.invoke('send-command', command)
    
    if (result.success) {
        logMessage('SENT', command.trim())
    } else {
        logMessage('ERROR', `Failed to send command: ${result.message}`)
    }
}

// Connect to selected port
async function connectToPort() {
    const portName = document.getElementById('portList').value
    if (!portName) {
        logMessage('ERROR', 'No port selected')
        return
    }

    const result = await ipcRenderer.invoke('connect-port', portName)
    if (result.success) {
        logMessage('SYSTEM', `Connected to ${portName}`)
        logMessage('SENT', ':C1;')  // Log the initial command that's sent
    } else {
        logMessage('ERROR', `Connection failed: ${result.message}`)
    }
}

// Format timestamp
function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });
}

// Log message to display
function logMessage(type, message) {
    const dataDisplay = document.getElementById('dataDisplay')
    const timestamp = getTimestamp()
    const entry = document.createElement('div')
    
    let color = 'black'
    switch(type) {
        case 'RECEIVED':
            color = 'green'
            break
        case 'SENT':
            color = 'blue'
            break
        case 'ERROR':
            color = 'red'
            break
        case 'SYSTEM':
            color = 'purple'
            break
    }
    
    // Handle multi-line messages with proper formatting
    const formattedMessage = message.split('\n').map(line => 
        line.trim()
    ).join('\n');
    
    entry.innerHTML = `
        <span style="color: gray">[${timestamp}]</span> 
        <span style="color: ${color}">[${type}]</span> 
        <pre style="display: block; margin: 5px 0; padding: 5px; background-color: #f5f5f5; border-radius: 4px;">${formattedMessage}</pre>
    `
    dataDisplay.appendChild(entry)
    
    // Auto-scroll to bottom
    dataDisplay.scrollTop = dataDisplay.scrollHeight
}

let dataPoints = [];
let pvChart, pressureChart, volumeChart;
let timeData = [];
// Reduce time points for better performance
// Reduced from 200

// Add these variables at the top with other declarations
let isPaused = {
    pv: false,
    pressure: false,
    volume: false
};

// Add these control functions
function togglePause(chartType) {
    isPaused[chartType] = !isPaused[chartType];
    const button = document.querySelector(`[data-chart="${chartType}"] .pause-btn`);
    if (button) {
        button.textContent = isPaused[chartType] ? "Resume" : "Pause";
    }
}

function resetZoom(chartType) {
    const chart = getChartByType(chartType);
    if (chart) {
        chart.resetZoom();
        chart.update('none');
    }
}

function clearData(chartType) {
    const chart = getChartByType(chartType);
    if (chart) {
        if (chartType === 'pv') {
            dataPoints = [];
            chart.data.datasets[0].data = [];
        } else {
            chart.data.datasets[0].data = Array(1000).fill(null);
        }
        chart.update('none');
    }
}

function getChartByType(chartType) {
    switch(chartType) {
        case 'pv': return pvChart;
        case 'pressure': return pressureChart;
        case 'volume': return volumeChart;
        default: return null;
    }
}

// Modify the chart initialization to better handle x-axis controls
function initCharts() {
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: {
            padding: {
                top: 10,
                right: 20,
                bottom: 10,
                left: 10
            }
        },
        plugins: {
            zoom: {
                pan: {
                    enabled: true,
                    mode: 'x',  // Changed to x-only
                    modifierKey: 'ctrl',  // Hold ctrl to pan
                },
                zoom: {
                    wheel: {
                        enabled: true,
                        modifierKey: 'ctrl'  // Hold ctrl to zoom
                    },
                    pinch: {
                        enabled: true
                    },
                    mode: 'x',  // Changed to x-only
                },
                limits: {
                    x: {min: 'original', max: 'original'},
                    y: {min: 'original', max: 'original'}
                }
            }
        }
    };

    // Initialize PV Chart
    const pvCtx = document.getElementById('pvChart').getContext('2d');
    pvChart = new Chart(pvCtx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'PV Diagram',
                data: [],
                showLine: true,
                fill: false,
                borderColor: 'rgb(75, 192, 192)',
                pointRadius: 2,
                tension: 0.1
            }]
        },
        options: {
            ...commonOptions,
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    min: 46000,
                    max: 47000,
                    title: {
                        display: true,
                        text: 'Volume'
                    },
                    ticks: {
                        stepSize: 100
                    }
                },
                y: {
                    type: 'linear',
                    min: 0,
                    max: 15000,
                    title: {
                        display: true,
                        text: 'Pressure'
                    },
                    ticks: {
                        stepSize: 1000
                    }
                }
            }
        }
    });

    // Modify Pressure vs Time Chart
    const pressureCtx = document.getElementById('pressureChart').getContext('2d');
    pressureChart = new Chart(pressureCtx, {
        type: 'line',
        data: {
            labels: Array.from({ length: 1000 }, (_, i) => ''),
            datasets: [{
                label: 'Pressure',
                data: Array(1000).fill(null),
                borderColor: 'rgb(255, 99, 132)',
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2
            }]
        },
        options: {
            ...commonOptions,
            scales: {
                y: {
                    min: 0,    // Changed from 4000 to 0
                    max: 20000,
                    title: {
                        display: true,
                        text: 'Pressure'
                    }
                },
                x: {
                    grid: {
                        display: true,
                        drawOnChartArea: true,
                        drawTicks: false
                    },
                    ticks: {
                        display: false
                    }
                }
            }
        }
    });

    // Modify Volume vs Time Chart
    const volumeCtx = document.getElementById('volumeChart').getContext('2d');
    volumeChart = new Chart(volumeCtx, {
        type: 'line',
        data: {
            labels: Array.from({ length: 1000 }, (_, i) => ''),
            datasets: [{
                label: 'Volume',
                data: Array(1000).fill(null),
                borderColor: 'rgb(54, 162, 235)',
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2
            }]
        },
        options: {
            ...commonOptions,
            scales: {
                y: {
                    min: 46000,
                    max: 47000,   // Changed from 46600 to 47000
                    title: {
                        display: true,
                        text: 'Volume'
                    },
                    ticks: {
                        stepSize: 100  // Adjusted for better scale visibility
                    }
                },
                x: {
                    grid: {
                        display: true,
                        drawOnChartArea: true,
                        drawTicks: false
                    },
                    ticks: {
                        display: false
                    }
                }
            }
        }
    });
}

// Sampling configuration
let packetCounter = 0;

// Modify the serial-data event handler to implement sampling
ipcRenderer.on('serial-data', (event, data) => {
    packetCounter = (packetCounter + 1) % SAMPLE_RATE;
    if (packetCounter !== 0) return;

    if (typeof data === 'object' && data.samples) {
        const samplesDisplay = data.samples.map(sample => 
            `Sample ${sample.sampleNumber.toString().padStart(2, '0')}: ` +
            `Pressure: ${sample.pressure.padStart(8, ' ')} ` +
            `(bytes: ${sample.pressureByte1.toString(16).padStart(2, '0')},` +
            `${sample.pressureByte2.toString(16).padStart(2, '0')}) | ` +
            `Volume: ${sample.volume.toString().padStart(10, ' ')}`
        ).join('\n');

        // Only log every Nth packet to reduce visual noise
        const message = `
Packet #${data.packetNumber}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Start Bytes: ${data.startBytes.toUpperCase()} (55 55)
${samplesDisplay}
End Bytes:   ${data.endBytes.toUpperCase()} (AA AA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Raw: ${data.fullPacket.toUpperCase()}`;
        
        logMessage('RECEIVED', message);
        
        // Limit the number of log entries
        const dataDisplay = document.getElementById('dataDisplay');
        while (dataDisplay.childNodes.length > MAX_LOG_ENTRIES) {
            dataDisplay.removeChild(dataDisplay.firstChild);
        }
        
        // Clear old data more aggressively
        if (dataPoints.length > MAX_DATA_POINTS) {
            dataPoints = dataPoints.slice(-MAX_DATA_POINTS/2);
        }
        
        updateCharts(data.samples);
    } else {
        logMessage('RECEIVED', data.trim());
    }
});

// Modify updateCharts to respect pause state
function updateCharts(samples) {
    if (!pvChart || !pressureChart || !volumeChart) return;

    // Cancel any pending animation frame
    if (window.chartUpdateRequest) {
        cancelAnimationFrame(window.chartUpdateRequest);
    }

    // Only process the number of samples specified in settings
    samples.slice(0, settings.sampleCount).forEach(sample => {
        const pressure = parseFloat(sample.pressure);
        const volume = parseFloat(sample.volume);
        
        if (pressure > settings.pressureMin && 
            pressure < settings.pressureMax && 
            volume > settings.volumeMin && 
            volume < settings.volumeMax) {

            // Update PV Chart if not paused
            if (!isPaused.pv) {
                const newPoint = { x: volume, y: pressure };
                dataPoints = [...dataPoints.slice(-settings.maxDataPoints + 1), newPoint];
                pvChart.data.datasets[0].data = dataPoints;
            }

            // Update Time-based Charts if not paused
            if (!isPaused.pressure) {
                const pressureData = pressureChart.data.datasets[0].data;
                pressureData.push(pressure);
                if (pressureData.length > 1000) pressureData.shift();
            }

            if (!isPaused.volume) {
                const volumeData = volumeChart.data.datasets[0].data;
                volumeData.push(volume);
                if (volumeData.length > 1000) volumeData.shift();
            }
        }
    });

    // Schedule a single update for all charts
    window.chartUpdateRequest = requestAnimationFrame(() => {
        pvChart.update('none');
        pressureChart.update('none');
        volumeChart.update('none');
    });
}

// Initialize Gridstack
let grid;
function initializeGrid() {
    grid = GridStack.init({
        column: 12,
        row: 8,
        cellHeight: 100,
        animate: true,
        draggable: {
            handle: '.grid-stack-item-content h2'
        },
        resizable: {
            handles: 'all'
        }
    });

    // After grid is initialized, initialize charts
    setTimeout(initCharts, 100);

    // Handle resize events
    grid.on('resizestop', function(event, element) {
        if (pvChart) pvChart.resize();
        if (pressureChart) pressureChart.resize();
        if (volumeChart) volumeChart.resize();
    });
}

// Add this function to initialize the settings inputs
function initializeSettingsInputs() {
    const inputs = {
        'maxLogEntries': settings.maxLogEntries,
        'maxDataPoints': settings.maxDataPoints,
        'maxTimePoints': settings.maxTimePoints,
        'pressureMin': settings.pressureMin,
        'pressureMax': settings.pressureMax,
        'volumeMin': settings.volumeMin,
        'volumeMax': settings.volumeMax,
        'sampleCount': settings.sampleCount
    };

    Object.entries(inputs).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.value = value;
        } else {
            console.warn(`Element with id '${id}' not found`);
        }
    });
}

// Modify the initialize function to include settings initialization
function initialize() {
    initializeConnection();
    initializeGrid();
    initializeSettingsInputs();
}

// Call initialize instead of just initializeConnection
initialize();

// Update the styles for better contrast and readability
document.head.insertAdjacentHTML('beforeend', `
    <style>
        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 10px;
            margin-bottom: 10px;
            background: #2f3542;
            border-radius: 4px;
        }
        
        .chart-controls {
            display: flex;
            gap: 8px;
            padding: 8px;
        }
        
        .chart-btn {
            padding: 6px 12px;
            min-width: 60px;
            height: 32px;
            border: none;
            background: #4a90e2;
            color: white;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        
        .chart-btn:hover {
            background: #357abd;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transform: translateY(-1px);
        }
        
        .chart-btn:active {
            background: #2d6da3;
            transform: translateY(0);
            box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }

        .pause-btn {
            background: #e74c3c;
        }

        .pause-btn:hover {
            background: #c0392b;
        }

        h2 {
            color: white;
            font-weight: 600;
            padding: 8px 0;
        }
        
        .chart-wrapper {
            position: relative;
            flex: 1;
            min-height: 0;
            background: #fff;
            padding: 8px;
            border-radius: 4px;
        }

        .settings-panel {
            display: flex;
            gap: 20px;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 4px;
            overflow-x: auto;
        }
        
        .settings-group {
            min-width: 200px;
            background: white;
            padding: 10px;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .settings-group h3 {
            margin: 0 0 10px 0;
            font-size: 14px;
            color: #333;
        }
        
        .setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .setting-item label {
            font-size: 12px;
            color: #666;
            margin-right: 10px;
        }
        
        .setting-item input {
            width: 80px;
            padding: 4px;
            border: 1px solid #ddd;
            border-radius: 3px;
        }
        
        .setting-item input:focus {
            outline: none;
            border-color: #4a90e2;
        }

        .setting-label {
            position: relative;
            display: flex;
            align-items: center;
        }

        .tooltip {
            display: none;
            position: absolute;
            background: #333;
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
            width: 200px;
            top: -30px;
            left: 0;
            z-index: 1000;
        }

        .setting-label:hover .tooltip {
            display: block;
        }

        .setting-item input[type="range"] {
            width: 100px;
        }

        .setting-item input[type="checkbox"] {
            width: auto;
        }
    </style>
`);

// Update the saveSettings function
function saveSettings() {
    const newSettings = {
        maxLogEntries: parseInt(document.getElementById('maxLogEntries').value) || settings.maxLogEntries,
        maxDataPoints: parseInt(document.getElementById('maxDataPoints').value) || settings.maxDataPoints,
        maxTimePoints: parseInt(document.getElementById('maxTimePoints').value) || settings.maxTimePoints,
        pressureMin: parseInt(document.getElementById('pressureMin').value) || settings.pressureMin,
        pressureMax: parseInt(document.getElementById('pressureMax').value) || settings.pressureMax,
        volumeMin: parseInt(document.getElementById('volumeMin').value) || settings.volumeMin,
        volumeMax: parseInt(document.getElementById('volumeMax').value) || settings.volumeMax,
        sampleCount: Math.min(10, Math.max(1, parseInt(document.getElementById('sampleCount').value) || settings.sampleCount))
    };

    // Update settings
    settings = newSettings;

    // Update the global variables
    MAX_LOG_ENTRIES = settings.maxLogEntries;
    MAX_DATA_POINTS = settings.maxDataPoints;
    MAX_TIME_POINTS = settings.maxTimePoints;

    // Update chart scales
    updateChartScales();
    
    // Clear existing data to apply new settings
    clearAllData();

    console.log('Settings saved:', settings); // Debug log
}

function updateChartScales() {
    if (pressureChart) {
        pressureChart.options.scales.y.min = settings.pressureMin;
        pressureChart.options.scales.y.max = settings.pressureMax;
        pressureChart.update('none');
    }
    if (volumeChart) {
        volumeChart.options.scales.y.min = settings.volumeMin;
        volumeChart.options.scales.y.max = settings.volumeMax;
        volumeChart.update('none');
    }
    if (pvChart) {
        pvChart.options.scales.x.min = settings.volumeMin;
        pvChart.options.scales.x.max = settings.volumeMax;
        pvChart.options.scales.y.min = settings.pressureMin;
        pvChart.options.scales.y.max = settings.pressureMax;
        pvChart.update('none');
    }
}

function clearAllData() {
    clearData('pv');
    clearData('pressure');
    clearData('volume');
}

function resetDefaultSettings() {
    const defaultSettings = {
        maxLogEntries: 100,
        maxDataPoints: 100,
        maxTimePoints: 100,
        sampleRate: 1,
        pressureMin: 3500,
        pressureMax: 15000,
        volumeMin: 46000,
        volumeMax: 47000,
        sampleCount: 1,
    };

    // Update all input fields with default values
    Object.keys(defaultSettings).forEach(key => {
        const input = document.getElementById(key);
        if (input) {
            input.value = defaultSettings[key];
        }
    });

    // Save the default settings
    settings = defaultSettings;
    updateChartScales();
    clearAllData();
}

// Make sure initialization happens after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initialize();
}); 
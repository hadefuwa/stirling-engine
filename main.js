const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { SerialPort } = require('serialport')

function createWindow() {
  const win = new BrowserWindow({
    show: false,  // Don't show until window is ready
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  win.maximize()
  win.show()

  win.loadFile('index.html')
  
  return win;
}

// List available ports
ipcMain.handle('list-ports', async () => {
  const ports = await SerialPort.list()
  return ports
})

let serialPort = null;
let dataBuffer = Buffer.alloc(0);
let packets = []; // We'll limit this array's size more aggressively

function parseSamples(packet) {
    const samples = [];
    
    // Start from byte 2 (index 2) and process 10 samples
    for (let i = 0; i < 10; i++) {
        const baseIndex = 2 + (i * 6); // Each sample is 6 bytes (2 for pressure, 4 for volume)
        
        // Get the two pressure bytes
        const pressureByte1 = packet[baseIndex];     // First byte
        const pressureByte2 = packet[baseIndex + 1]; // Second byte
        
        // Calculate pressure using the formula: pressure = byte2 + (byte1 * 256.0)
        const pressure = pressureByte2 + (pressureByte1 * 256.0);
        
        // Get the four volume bytes
        const volumeByte1 = packet[baseIndex + 2];
        const volumeByte2 = packet[baseIndex + 3];
        const volumeByte3 = packet[baseIndex + 4];
        const volumeByte4 = packet[baseIndex + 5];
        
        // Calculate volume using the formula from the comments
        const volumeRx = volumeByte1 + 
                        (volumeByte2 * 0x100) + 
                        (volumeByte3 * 0x10000) + 
                        (volumeByte4 * 0x1000000);
        
        const volume = volumeRx / 1000;
        
        samples.push({
            sampleNumber: i + 1,
            pressureByte1,
            pressureByte2,
            pressure: pressure.toFixed(2),
            volumeBytes: [volumeByte1, volumeByte2, volumeByte3, volumeByte4],
            volume: volume.toFixed(3)  // 3 decimal places since we divided by 1000
        });
    }
    
    return samples;
}

// Connect to port
ipcMain.handle('connect-port', async (event, portName) => {
  try {
    serialPort = new SerialPort({
      path: portName,
      baudRate: 921600
    })

    serialPort.on('data', (data) => {
      // Clear old data if buffer gets too large
      if (dataBuffer.length > 128) {  // Reduced from 1024
        dataBuffer = Buffer.alloc(0);
      }
      
      dataBuffer = Buffer.concat([dataBuffer, data]);

      while (dataBuffer.length >= 64) {
        let startIndex = -1;
        for (let i = 0; i < dataBuffer.length - 1; i++) {
          if (dataBuffer[i] === 0x55 && dataBuffer[i + 1] === 0x55) {
            startIndex = i;
            break;
          }
        }

        if (startIndex === -1 || startIndex + 64 > dataBuffer.length) {
          // Clear the buffer if no valid start found
          dataBuffer = Buffer.alloc(0);
          break;
        }

        const packet = dataBuffer.slice(startIndex, startIndex + 64);

        if (packet[62] === 0xAA && packet[63] === 0xAA) {
          const hexData = Array.from(packet).map(b => b.toString(16).padStart(2, '0')).join(' ');
          
          const samples = parseSamples(packet);
          
          // Keep only the last 10 packets instead of 1000
          packets.push(packet);
          if (packets.length > 10) packets.shift();

          // Use setImmediate to prevent blocking the event loop
          setImmediate(() => {
            event.sender.send('serial-data', {
              timestamp: Date.now(),
              fullPacket: hexData,
              startBytes: packet.slice(0, 2).toString('hex'),
              endBytes: packet.slice(62, 64).toString('hex'),
              samples: samples,
              packetNumber: packets.length
            });
          });
        }

        dataBuffer = dataBuffer.slice(startIndex + 64);
      }
    })

    // Send initial command after connection
    serialPort.write(':C1;\n', (err) => {
      if (err) {
        console.error('Error writing to port:', err)
      }
    })

    return { success: true, message: 'Connected successfully' }
  } catch (error) {
    return { success: false, message: error.message }
  }
})

// Add handler to get stored packets if needed
ipcMain.handle('get-packets', () => {
  return packets;
})

// Handle sending commands
ipcMain.handle('send-command', async (event, command) => {
  if (!serialPort || !serialPort.isOpen) {
    return { success: false, message: 'Port not connected' }
  }

  try {
    await new Promise((resolve, reject) => {
      serialPort.write(command, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    return { success: true }
  } catch (error) {
    return { success: false, message: error.message }
  }
})

let mainWindow;

app.whenReady().then(() => {
  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
}) 
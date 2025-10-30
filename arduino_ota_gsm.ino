// Arduino Uno OTA Firmware Downloader using Quectel EC200U CN GSM Module
// Downloads firmware to OTADrive storage and flashes ESP32S3 (similar to OTADrive library)
// Client name: my_client
// Based on Quectel EC200U HTTP AT Commands Manual

#include <SoftwareSerial.h>

//GET /deviceapi/firmware.bin?group_id=34be03e4-e706-4214-840f-2695fecc5e7a&device_id=DE453AB4&api_key=dc360819bbeae6fb17fa39b09cc30f44&Range=bytes=0-1023 HTTP/1.1
//[GET/deviceapi/firmware.bin?group_id=34be03e4-e706-4214-840f-2695fecc5e7a&device_id=DE453AB4&api_key=dc360819bbeae6fb17fa39b09cc30f44&Range:bytes=0-1023
// GSM Module Serial (adjust pins as needed)
SoftwareSerial GSM(10, 11); // RX, TX (EC200U CN)

// ESP32S3 Serial for flashing (adjust pins as needed)
SoftwareSerial ESP32(8, 9); // RX, TX

// Configuration
const char* SERVER_HOST = "108.181.202.20"; // Replace with your server
const int SERVER_PORT = 3000;
const char* API_KEY = "dc360819bbeae6fb17fa39b09cc30f44"; // Replace with actual API key
const char* DEVICE_ID = "DE453AB4";
const char* APN = "your-apn"; // Replace with your GSM provider APN

// Firmware download settings
const int CHUNK_SIZE = 1024; // 1KB chunks (adjust based on memory constraints)
const int BUFFER_SIZE = 1024;
char buffer[BUFFER_SIZE];

// Progress tracking
unsigned long totalSize = 0;
unsigned long downloadedSize = 0;
int progressPercent = 0;

// Firmware version info
String currentVersion = "0.0.0";
String latestVersion = "";
String firmwareMD5 = "";

// OTADrive storage configuration
// Choose your storage method: SPIFFS, SD card, EEPROM, etc.
// For this example, we'll use placeholders that you need to implement

void setup() {
  Serial.begin(9600);
  GSM.begin(115200); // EC200U CN default baud rate
  ESP32.begin(115200); // ESP32S3 baud rate

  Serial.println("Arduino OTA GSM Downloader Starting...");

  // Initialize GSM module
  if (!initializeGSM()) {
    Serial.println("GSM initialization failed!");
    while (1);
  }

  // Check for firmware updates
  checkForUpdates();

  // If update available, download and flash
  if (isUpdateAvailable()) {
    downloadAndFlashFirmware();
  } else {
    Serial.println("No updates available.");
  }
}

void loop() {
  // Nothing to do in loop
}

bool initializeGSM() {
  Serial.println("Initializing EC200U CN GSM module...");

  // Test basic communication
  if (!sendGSMCommand("AT", 1000)) {
    Serial.println("GSM module not responding to AT");
    return false;
  }
  Serial.println("GSM module responding");

  // Disable echo
  sendGSMCommand("ATE0", 1000);

  // Check SIM card status
  String simResponse = sendGSMCommandWithResponse("AT+CPIN?", 5000);
  if (simResponse.indexOf("READY") == -1) {
    Serial.println("SIM card not ready");
    return false;
  }
  Serial.println("SIM card ready");

  // Check network registration
  String regResponse = sendGSMCommandWithResponse("AT+CREG?", 5000);
  if (regResponse.indexOf("+CREG: 0,1") == -1 && regResponse.indexOf("+CREG: 0,5") == -1) {
    Serial.println("Not registered to network");
    return false;
  }
  Serial.println("Registered to network");

  // Set APN (adjust for your provider)
  String apnCommand = "AT+CGDCONT=1,\"IP\",\"" + String(APN) + "\"";
  if (!sendGSMCommand(apnCommand, 1000)) {
    Serial.println("Failed to set APN");
    return false;
  }

  // Activate PDP context
  if (!sendGSMCommand("AT+CGACT=1,1", 10000)) {
    Serial.println("Failed to activate PDP context");
    return false;
  }
  Serial.println("PDP context activated");

  // Get local IP address
  String ipResponse = sendGSMCommandWithResponse("AT+CGPADDR=1", 5000);
  Serial.print("Local IP: ");
  Serial.println(ipResponse);

  Serial.println("GSM module initialized successfully");
  return true;
}

bool sendGSMCommand(String command, int timeout) {
  GSM.println(command);
  delay(100);

  unsigned long startTime = millis();
  String response = "";

  while (millis() - startTime < timeout) {
    while (GSM.available()) {
      char c = GSM.read();
      response += c;
    }

    if (response.indexOf("OK") != -1) {
      return true;
    }

    if (response.indexOf("ERROR") != -1) {
      return false;
    }
  }

  return false;
}

String sendGSMCommandWithResponse(String command, int timeout) {
  GSM.println(command);
  delay(100);

  unsigned long startTime = millis();
  String response = "";

  while (millis() - startTime < timeout) {
    while (GSM.available()) {
      char c = GSM.read();
      response += c;
    }
  }

  return response;
}

void checkForUpdates() {
  Serial.println("Checking for firmware updates...");

  // Construct URL path
  String urlPath = "/deviceapi/check?device_id=" + String(DEVICE_ID) + "&api_key=" + String(API_KEY);

  String responseBody;
  if (sendHTTPGet(urlPath, responseBody)) {
    // Parse JSON response
    // Expected format: {"version":"1.2.3","md5":"hash","size":12345,"url":"/deviceapi/firmware.bin?group_id=xxx"}

    // Simple JSON parsing (you might want to use ArduinoJson library for better parsing)
    int versionStart = responseBody.indexOf("\"version\":\"");
    if (versionStart != -1) {
      versionStart += 11; // Length of "\"version\":\""
      int versionEnd = responseBody.indexOf("\"", versionStart);
      if (versionEnd != -1) {
        latestVersion = responseBody.substring(versionStart, versionEnd);
        Serial.print("Latest version: ");
        Serial.println(latestVersion);
      }
    }

    int sizeStart = responseBody.indexOf("\"size\":");
    if (sizeStart != -1) {
      sizeStart += 7; // Length of "\"size\":"
      int sizeEnd = responseBody.indexOf(",", sizeStart);
      if (sizeEnd == -1) sizeEnd = responseBody.indexOf("}", sizeStart);
      if (sizeEnd != -1) {
        totalSize = responseBody.substring(sizeStart, sizeEnd).toInt();
        Serial.print("Firmware size: ");
        Serial.println(totalSize);
      }
    }

    Serial.println("Update check completed successfully");
  } else {
    Serial.println("Failed to check for updates");
  }
}

bool sendHTTPGet(String urlPath, String& responseBody) {
  // Initialize HTTP service
  if (!sendGSMCommand("AT+HTTPINIT", 2000)) {
    Serial.println("Failed to initialize HTTP");
    return false;
  }

  // Set CID parameter
  if (!sendGSMCommand("AT+HTTPPARA=\"CID\",1", 1000)) {
    Serial.println("Failed to set CID");
    sendGSMCommand("AT+HTTPTERM", 1000);
    return false;
  }

  // Set URL parameter
  String fullUrl = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + urlPath;
  String urlCommand = "AT+HTTPPARA=\"URL\",\"" + fullUrl + "\"";
  if (!sendGSMCommand(urlCommand, 2000)) {
    Serial.println("Failed to set URL");
    sendGSMCommand("AT+HTTPTERM", 1000);
    return false;
  }

  // Set content type
  if (!sendGSMCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000)) {
    Serial.println("Failed to set content type");
    sendGSMCommand("AT+HTTPTERM", 1000);
    return false;
  }

  // Perform GET action
  String actionResponse = sendGSMCommandWithResponse("AT+HTTPACTION=0", 15000);
  if (actionResponse.indexOf("200") == -1) {
    Serial.println("HTTP GET failed");
    sendGSMCommand("AT+HTTPTERM", 1000);
    return false;
  }

  // Get response data
  GSM.println("AT+HTTPREAD");
  delay(100);

  unsigned long startTime = millis();
  responseBody = "";
  bool readingData = false;
  int contentLength = 0;

  while (millis() - startTime < 10000) {
    while (GSM.available()) {
      String line = GSM.readStringUntil('\n');
      line.trim();

      if (line.startsWith("+HTTPREAD: ")) {
        // Parse content length
        int colonIndex = line.indexOf(':');
        if (colonIndex != -1) {
          contentLength = line.substring(colonIndex + 1).toInt();
          readingData = true;
        }
      } else if (readingData && line.length() > 0) {
        responseBody += line + "\n";
        if (responseBody.length() >= contentLength) {
          break;
        }
      } else if (line == "OK") {
        break;
      }
    }

    if (readingData && responseBody.length() >= contentLength) {
      break;
    }
  }

  // Terminate HTTP service
  sendGSMCommand("AT+HTTPTERM", 1000);

  return responseBody.length() > 0;
}

bool isUpdateAvailable() {
  // Compare versions (simplified - you might want more sophisticated version comparison)
  return latestVersion != currentVersion && latestVersion != "";
}

void downloadAndFlashFirmware() {
  Serial.println("Starting firmware download to OTADrive storage...");

  // Get firmware size first
  if (!getFirmwareSize()) {
    Serial.println("Failed to get firmware size");
    return;
  }

  Serial.print("Firmware size: ");
  Serial.println(totalSize);

  // Download firmware in chunks and store in OTADrive format
  unsigned long offset = 0;
  int chunkCount = 0;

  // Initialize OTADrive storage (this would be implemented based on your storage method)
  if (!initializeOTADriveStorage(totalSize)) {
    Serial.println("Failed to initialize OTADrive storage");
    return;
  }

  while (offset < totalSize) {
    int chunkSize = min(CHUNK_SIZE, (int)(totalSize - offset));

    if (downloadChunk(offset, chunkSize)) {
      // Store chunk in OTADrive storage instead of sending directly to ESP32
      if (!storeChunkInOTADrive(buffer, chunkSize, offset)) {
        Serial.println("Failed to store chunk in OTADrive");
        return;
      }

      offset += chunkSize;
      downloadedSize = offset;
      chunkCount++;

      // Update progress
      int newProgress = (downloadedSize * 100) / totalSize;
      if (newProgress != progressPercent) {
        progressPercent = newProgress;
        Serial.print("Download progress: ");
        Serial.print(progressPercent);
        Serial.println("%");
      }
    } else {
      Serial.println("Failed to download chunk, retrying...");
      delay(1000);
    }
  }

  Serial.println("Download completed!");

  // Now flash the stored firmware to ESP32S3 using OTADrive method
  if (flashFirmwareFromOTADrive()) {
    Serial.println("Firmware update completed successfully!");
  } else {
    Serial.println("Firmware flashing failed!");
  }
}

bool getFirmwareSize() {
  // The size is already obtained during checkForUpdates()
  // This function is kept for compatibility but size is set during update check
  if (totalSize > 0) {
    Serial.print("Firmware size already known: ");
    Serial.println(totalSize);
    return true;
  }

  // Fallback: make a small range request to get content length
  String urlPath = "/deviceapi/firmware.bin?group_id=34be03e4-e706-4214-840f-2695fecc5e7a&device_id=" + String(DEVICE_ID) + "&api_key=" + String(API_KEY);

  // Initialize HTTP service
  if (!sendGSMCommand("AT+HTTPINIT", 2000)) return false;

  // Set parameters
  sendGSMCommand("AT+HTTPPARA=\"CID\",1", 1000);
  String fullUrl = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + urlPath;
  String urlCommand = "AT+HTTPPARA=\"URL\",\"" + fullUrl + "\"";
  sendGSMCommand(urlCommand, 2000);

  // Set Range header for small request
  sendGSMCommand("AT+HTTPPARA=\"USERDATA\",\"Range: bytes=0-0\"", 1000);

  // Perform GET action
  String actionResponse = sendGSMCommandWithResponse("AT+HTTPACTION=0", 15000);

  // Parse response for Content-Range header
  if (actionResponse.indexOf("206") != -1) { // Partial Content
    int rangeIndex = actionResponse.indexOf("Content-Range:");
    if (rangeIndex != -1) {
      String rangeHeader = actionResponse.substring(rangeIndex);
      int slashIndex = rangeHeader.indexOf("/");
      if (slashIndex != -1) {
        String totalStr = rangeHeader.substring(slashIndex + 1);
        totalStr = totalStr.substring(0, totalStr.indexOf("\r"));
        totalSize = totalStr.toInt();
        Serial.print("Parsed firmware size: ");
        Serial.println(totalSize);
      }
    }
  }

  // Terminate HTTP service
  sendGSMCommand("AT+HTTPTERM", 1000);

  return totalSize > 0;
}

bool downloadChunk(unsigned long offset, int chunkSize) {
  // Build URL with Range as query parameter (fallback method)
  // Some GSM modules don't support custom headers properly
  String urlPath = "/deviceapi/firmware.bin?group_id=34be03e4-e706-4214-840f-2695fecc5e7a&device_id=" +
                   String(DEVICE_ID) + "&api_key=" + String(API_KEY) + "&Range=bytes=" +
                   String(offset) + "-" + String(offset + chunkSize - 1);

  // Initialize HTTP service
  if (!sendGSMCommand("AT+HTTPINIT", 2000)) {
    Serial.println("Failed to initialize HTTP for chunk download");
    return false;
  }

  // Set parameters
  sendGSMCommand("AT+HTTPPARA=\"CID\",1", 1000);

  String fullUrl = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + urlPath;
  String urlCommand = "AT+HTTPPARA=\"URL\",\"" + fullUrl + "\"";
  if (!sendGSMCommand(urlCommand, 2000)) {
    Serial.println("Failed to set URL");
    sendGSMCommand("AT+HTTPTERM", 1000);
    return false;
  }

  // Set content type (required)
  sendGSMCommand("AT+HTTPPARA=\"CONTENT\",\"application/octet-stream\"", 1000);

  // Perform GET action
  String actionResponse = sendGSMCommandWithResponse("AT+HTTPACTION=0", 20000);

  Serial.print("HTTP Action Response: ");
  Serial.println(actionResponse);

  if (actionResponse.indexOf("206") == -1 && actionResponse.indexOf("200") == -1) {
    Serial.println("HTTP request failed - no 200 or 206 response");
    sendGSMCommand("AT+HTTPTERM", 1000);
    return false;
  }

  // Read the chunk data
  GSM.println("AT+HTTPREAD");
  delay(200);

  int bytesRead = 0;
  unsigned long startTime = millis();
  bool readingData = false;
  int expectedLength = chunkSize;

  while (bytesRead < expectedLength && millis() - startTime < 15000) {
    while (GSM.available()) {
      String line = GSM.readStringUntil('\n');
      line.trim();

      if (line.startsWith("+HTTPREAD: ")) {
        // Parse data length from +HTTPREAD: LEN response
        int colonIndex = line.indexOf(':');
        if (colonIndex != -1) {
          String lenStr = line.substring(colonIndex + 1);
          lenStr.trim();
          expectedLength = lenStr.toInt();
          readingData = true;
          Serial.print("Expected length: ");
          Serial.println(expectedLength);
        }
      } else if (readingData && line.length() > 0) {
        // Read binary data
        for (size_t i = 0; i < line.length() && bytesRead < BUFFER_SIZE; i++) {
          buffer[bytesRead++] = line.charAt(i);
        }
      } else if (line == "OK") {
        break;
      }
    }

    if (bytesRead >= expectedLength) {
      break;
    }
  }

  // Terminate HTTP service
  sendGSMCommand("AT+HTTPTERM", 1000);

  Serial.print("Downloaded chunk: ");
  Serial.print(bytesRead);
  Serial.print("/");
  Serial.print(expectedLength);
  Serial.println(" bytes");

  return bytesRead > 0; // Accept partial reads for now
}

// OTADrive storage functions (implement based on your storage method)
// These functions handle storing firmware chunks and flashing similar to OTADrive library

bool initializeOTADriveStorage(unsigned long firmwareSize) {
  // Initialize storage for firmware (SPIFFS, SD card, etc.)
  // This is a placeholder - implement based on your storage method
  Serial.println("Initializing OTADrive storage...");
  // Return true if storage initialized successfully
  return true;
}

bool storeChunkInOTADrive(char* data, int length, unsigned long offset) {
  // Store chunk in OTADrive storage
  // This is a placeholder - implement based on your storage method
  Serial.print("Storing chunk at offset: ");
  Serial.println(offset);
  // Return true if chunk stored successfully
  return true;
}

bool flashFirmwareFromOTADrive() {
  // Flash firmware from OTADrive storage to ESP32S3
  // This implements the OTADrive library approach
  Serial.println("Starting firmware flash from OTADrive storage...");

  // Put ESP32S3 into OTA mode (reset or special command)
  ESP32.println("OTA_MODE"); // Command to put ESP32 into OTA receive mode
  delay(1000);

  // Read firmware from storage and send to ESP32S3 in chunks
  unsigned long offset = 0;
  const int FLASH_CHUNK_SIZE = 1024; // Size for flashing chunks

  while (offset < totalSize) {
    // Read chunk from OTADrive storage
    char flashBuffer[FLASH_CHUNK_SIZE];
    int chunkSize = min(FLASH_CHUNK_SIZE, (int)(totalSize - offset));

    // Read chunk from storage (implement based on your storage method)
    if (!readChunkFromOTADrive(flashBuffer, chunkSize, offset)) {
      Serial.println("Failed to read chunk from storage");
      return false;
    }

    // Send chunk to ESP32S3 for flashing
    if (!sendChunkToESP32ForFlash(flashBuffer, chunkSize, offset)) {
      Serial.println("Failed to send chunk to ESP32S3");
      return false;
    }

    offset += chunkSize;

    // Update progress
    int progress = (offset * 100) / totalSize;
    Serial.print("Flash progress: ");
    Serial.print(progress);
    Serial.println("%");
  }

  // Finalize flash
  return finalizeESP32Flash();
}

bool readChunkFromOTADrive(char* buffer, int length, unsigned long offset) {
  // Read chunk from OTADrive storage
  // Implement based on your storage method (SPIFFS, SD card, etc.)
  // This is a placeholder
  return true;
}

bool sendChunkToESP32ForFlash(char* data, int length, unsigned long offset) {
  // Send chunk to ESP32S3 for flashing using OTADrive protocol
  // Use proper OTADrive flashing commands

  // Send start of chunk command
  ESP32.write(0xAA); // Start marker
  ESP32.write((length >> 8) & 0xFF); // Length high byte
  ESP32.write(length & 0xFF); // Length low byte
  ESP32.write((offset >> 24) & 0xFF); // Offset high byte
  ESP32.write((offset >> 16) & 0xFF); // Offset
  ESP32.write((offset >> 8) & 0xFF);  // Offset
  ESP32.write(offset & 0xFF);         // Offset low byte

  // Send data
  for (int i = 0; i < length; i++) {
    ESP32.write(data[i]);
  }

  ESP32.write(0x55); // End marker

  // Wait for acknowledgment
  unsigned long startTime = millis();
  while (!ESP32.available() && millis() - startTime < 5000);

  if (ESP32.available()) {
    char ack = ESP32.read();
    return (ack == 0xAC); // Success acknowledgment
  }

  return false;
}

bool finalizeESP32Flash() {
  // Send finalization command to ESP32S3
  ESP32.write(0xFF); // Finalize flash command
  ESP32.write(0xFF);
  ESP32.write(0xFF);

  // Wait for completion acknowledgment
  delay(5000);

  if (ESP32.available()) {
    char response = ESP32.read();
    if (response == 0xFC) { // Flash complete
      Serial.println("ESP32S3 flash completed successfully");
      return true;
    } else {
      Serial.println("ESP32S3 flash failed");
      return false;
    }
  }

  Serial.println("No response from ESP32S3");
  return false;
}
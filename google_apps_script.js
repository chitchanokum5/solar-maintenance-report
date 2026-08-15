/**
 * Google Apps Script Web App Endpoint for KKE Solar Maintenance Report
 * 
 * Instructions:
 * 1. Open https://script.google.com/home/projects/1kRVp5_6UcFCcPJpFpA9nbEQoPPtjTqDkKIMQw-EkwwPxL71wza0y9qiq/edit
 * 2. Delete any default code and paste this script
 * 3. Click "Save" (disk icon)
 * 4. Click "Deploy" -> "Manage deployments" -> Edit -> Select Version: "New version" -> Click "Deploy"
 */

// Google Drive folder ID shared by user
var FOLDER_ID = "1hEiKDf8VtQpIOOCX7kZxaXAn0e4TxpVT";

// Helper to read database JSON from Google Drive
function getReportsJson() {
  // Automatically import any new historical rows from the Google Sheet logs first
  try {
    importReportsFromSheet();
  } catch (err) {
    Logger.log("Import from sheet failed: " + err.toString());
  }

  var mainFolder = DriveApp.getFolderById(FOLDER_ID);
  var files = mainFolder.getFilesByName("reports_db.json");
  if (files.hasNext()) {
    var file = files.next();
    return file.getAs("application/json").getDataAsString();
  }
  return "[]";
}

// Helper to write database JSON to Google Drive
function saveReportsJson(jsonString) {
  var mainFolder = DriveApp.getFolderById(FOLDER_ID);
  var files = mainFolder.getFilesByName("reports_db.json");
  if (files.hasNext()) {
    var file = files.next();
    file.setContent(jsonString);
  } else {
    mainFolder.createFile("reports_db.json", jsonString, "application/json");
  }
}

// Automatically import reports from the Google Sheet logs to the JSON database
function importReportsFromSheet() {
  var mainFolder = DriveApp.getFolderById(FOLDER_ID);
  
  // 1. Get Google Sheet file
  var sheetName = "KKE Solar Maintenance Logs";
  var files = mainFolder.getFilesByName(sheetName);
  if (!files.hasNext()) return;
  
  var fileSpreadsheet = files.next();
  var spreadsheet = SpreadsheetApp.openById(fileSpreadsheet.getId());
  var sheet = spreadsheet.getSheets()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return; // Only header row exists
  
  // 2. Read all rows (from row 2 down to lastRow)
  var values = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  
  // 3. Read existing JSON database file
  var jsonFile;
  var reportsList = [];
  var filesJson = mainFolder.getFilesByName("reports_db.json");
  if (filesJson.hasNext()) {
    jsonFile = filesJson.next();
    try {
      reportsList = JSON.parse(jsonFile.getAs("application/json").getDataAsString());
    } catch (e) {
      reportsList = [];
    }
  }
  
  // Build a set of existing report IDs
  var existingIds = {};
  reportsList.forEach(function(r) {
    if (r && r.id) existingIds[r.id] = true;
  });
  
  var newReportsCount = 0;
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = row[1] || ""; // Job Number
    if (!id || id.trim() === "" || id === "-") {
      // Fallback ID if Job Number is missing
      id = "SR-TEMP-" + i;
    }
    
    // If this report already exists in the JSON, skip it
    if (existingIds[id]) continue;
    
    // Parse system size (kWp)
    var sizeVal = row[5] || 0;
    var size = parseFloat(sizeVal.toString().replace(/[^0-9.]/g, "")) || 0;
    
    // Parse maintenance date
    var dateVal = row[2];
    var dateStr = "";
    if (dateVal instanceof Date) {
      dateStr = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "yyyy-MM-dd");
    } else {
      dateStr = (dateVal || "").toString();
    }
    
    // Parse creation timestamp (createdAt) from sheet Timestamp column
    var createdAtVal = row[0];
    var createdAtStr = "";
    if (createdAtVal instanceof Date) {
      createdAtStr = createdAtVal.toISOString();
    } else if (createdAtVal) {
      try {
        createdAtStr = new Date(createdAtVal).toISOString();
      } catch (e) {
        createdAtStr = new Date().toISOString();
      }
    } else {
      createdAtStr = new Date().toISOString();
    }

    // Build new report object
    var report = {
      id: id,
      createdAt: createdAtStr,
      jobNumber: id,
      maintenanceDate: dateStr,
      customerName: row[3] || "-",
      location: row[4] || "-",
      systemSize: size,
      maintenanceType: row[6] || "Preventive Maintenance",
      technicianName: row[7] || "-",
      status: row[8] || "Normal",
      recommendations: row[9] || "-",
      pdfUrl: row[10] || "",
      checks: {},
      inverters: []
    };
    
    // Set default checks to Pass for checklist items to avoid empty checks UI
    report.checks = {
      panelsCracks: "Pass", panelsDirt: "Pass", panelsShifting: "Pass", panelsMpptVolt: "Pass", panelsMpptCurrent: "Pass", panelsDcWiring: "Pass", panelsMc4: "Pass", panelsClamps: "Pass", panelsGround: "Pass",
      ajbTerminalConn: "Pass", ajbTerminalTemp: "Pass", ajbFuseConn: "Pass", ajbFuseTemp: "Pass", ajbSpdConn: "Pass", ajbSpdTemp: "Pass", ajbSwitchConn: "Pass", ajbSwitchTemp: "Pass", ajbCleanliness: "Pass",
      inverterTemp: "Pass", inverterMc4: "Pass",
      mdbMainMccbConn: "Pass", mdbMainMccbTemp: "Pass", mdbSpdConn: "Pass", mdbSpdTemp: "Pass", mdbBranchMccbConn: "Pass", mdbBranchMccbTemp: "Pass", mdbSelector: "Pass", mdbPqMeter: "Pass", mdbCleanliness: "Pass",
      rsdIntact: "Pass", rsdMounting: "Pass", rsdCableClip: "Pass", rsdSaltStain: "Pass", rsdConnRsd: "Pass", rsdConnPv: "Pass", rsdTemp: "Pass", rsdVoltageRange: "Pass", rsdVoltageString: "Pass",
      optIntact: "Pass", optMounting: "Pass", optCableClip: "Pass", optConnector: "Pass", optConnOpt: "Pass", optVoltage: "Pass",
      ctrlClean: "Pass", ctrlMounting: "Pass", ctrlVoltIn: "Pass", ctrlVoltOut: "Pass", ctrlEmergencyTest: "Pass", ctrlTerminal: "Pass",
      weatherPhysical: "Pass", weatherSensorClean: "Pass", weatherTerminal: "Pass", weatherConverter: "Pass", weatherSignalOut: "Pass", weatherSignalIn: "Pass", weatherSupport: "Pass", weatherCalib: "Pass",
      waterPumpUsable: "Pass", waterPumpRun: "Pass", waterCabinet: "Pass", waterCabinetDevice: "Pass", waterPipes: "Pass"
    };
    
    reportsList.push(report);
    existingIds[id] = true;
    newReportsCount++;
  }
  
  // 4. Save updated reports list back to JSON
  if (newReportsCount > 0) {
    // Sort reports by createdAt descending
    reportsList.sort(function(a, b) {
      var dateA = new Date(a.createdAt || a.maintenanceDate || 0);
      var dateB = new Date(b.createdAt || b.maintenanceDate || 0);
      return dateB - dateA;
    });
    
    var jsonContent = JSON.stringify(reportsList);
    if (jsonFile) {
      jsonFile.setContent(jsonContent);
    } else {
      mainFolder.createFile("reports_db.json", jsonContent, "application/json");
    }
  }
}

function doGet(e) {
  // Check if it is fetching reports database
  if (e && e.parameter && e.parameter.action === "getReports") {
    try {
      var data = getReportsJson();
      return ContentService.createTextOutput(data).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: error.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return HtmlService.createHtmlOutput(
    "<html><head><title>KKE Solar Sync API</title>" +
    "<meta charset='UTF-8'>" +
    "<style>body { font-family: sans-serif; text-align: center; padding-top: 100px; background-color: #0f172a; color: #f8fafc; margin: 0; }" +
    ".card { background: #1e293b; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); display: inline-block; max-width: 450px; border: 1px solid #334155; }" +
    "h1 { color: #10b981; margin-top: 0; font-size: 1.8rem; }" +
    "p { line-height: 1.6; font-size: 0.95rem; color: #cbd5e1; }" +
    ".badge { display: inline-block; background-color: rgba(16, 185, 129, 0.15); color: #10b981; padding: 4px 12px; border-radius: 20px; font-weight: bold; font-size: 0.8rem; border: 1px solid rgba(16, 185, 129, 0.3); margin-bottom: 15px; }" +
    "</style></head><body>" +
    "<div class='card'>" +
    "<div class='badge'>✓ Connection Active</div>" +
    "<h1>KKE Solar Sync API</h1>" +
    "<p>ระบบเชื่อมต่อ Google Drive และ Google Sheets ทำงานได้ปกติพร้อมรับข้อมูลรายงานซ่อมบำรุงแล้ว!</p>" +
    "<p style='font-size: 0.8rem; color: #94a3b8; border-top: 1px solid #334155; padding-top: 15px; margin-top: 15px;'>" +
    "กรุณาบันทึกลิงก์ URL นี้ในช่อง <strong>'ตั้งค่า Google Drive'</strong> ของเว็บไซต์ Solar Maintenance ได้เลยครับ</p>" +
    "</div>" +
    "</body></html>"
  );
}

function doPost(e) {
  try {
    // Parse incoming JSON
    var data = JSON.parse(e.postData.contents);
    
    // Check if it is saving reports database
    if (data && data.action === "saveReports") {
      saveReportsJson(JSON.stringify(data.reports));
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Database synced successfully!"
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var fileName = data.fileName || "Solar_Report.pdf";
    var pdfData = data.pdfData; // Base64 PDF string
    var metadata = data.metadata || {};
    
    // 1. Get Google Drive folder by ID
    var mainFolder = DriveApp.getFolderById(FOLDER_ID);
    
    // Extract list of all technicians listed on the report
    var techList = [];
    if (metadata.technicians && metadata.technicians !== "-") {
      var rawTechs = metadata.technicians.split(",");
      for (var i = 0; i < rawTechs.length; i++) {
        var tech = rawTechs[i].trim();
        // Remove roles like (Senior Foreman), (Service Engineer), (Foreman)
        var cleanName = tech.split(" (")[0].trim();
        if (cleanName && techList.indexOf(cleanName) === -1) {
          techList.push(cleanName);
        }
      }
    }
    
    if (techList.length === 0) {
      techList.push("ช่างทั่วไป");
    }
    
    // 2. Save PDF file into each technician's subfolder
    var pdfBlob = Utilities.newBlob(Utilities.base64Decode(pdfData), 'application/pdf', fileName);
    var fileUrl = "";
    var firstFolderUrl = "";
    var mainFile;
    
    for (var i = 0; i < techList.length; i++) {
      var currentTech = techList[i];
      
      // Get or create technician subfolder inside the main folder
      var subFolders = mainFolder.getFoldersByName(currentTech);
      var targetFolder;
      if (subFolders.hasNext()) {
        targetFolder = subFolders.next();
      } else {
        targetFolder = mainFolder.createFolder(currentTech);
      }
      
      if (i === 0) {
        // Create the primary file in the first technician's folder
        mainFile = targetFolder.createFile(pdfBlob);
        fileUrl = mainFile.getUrl();
        firstFolderUrl = targetFolder.getUrl();
      } else {
        // Copy the primary file into other technicians' folders
        mainFile.makeCopy(fileName, targetFolder);
      }
    }
    
    // 3. Get or create Google Sheet for logs in the same main folder
    var sheetName = "KKE Solar Maintenance Logs";
    var files = mainFolder.getFilesByName(sheetName);
    var spreadsheet;
    var sheet;
    
    if (files.hasNext()) {
      var fileSpreadsheet = files.next();
      spreadsheet = SpreadsheetApp.openById(fileSpreadsheet.getId());
      sheet = spreadsheet.getSheets()[0];
    } else {
      // Create new spreadsheet inside the folder
      spreadsheet = SpreadsheetApp.create(sheetName);
      // Move the spreadsheet to the folder
      var fileSpreadsheet = DriveApp.getFileById(spreadsheet.getId());
      mainFolder.addFile(fileSpreadsheet);
      DriveApp.getRootFolder().removeFile(fileSpreadsheet);
      
      sheet = spreadsheet.getSheets()[0];
      // Set headers
      sheet.appendRow([
        "วันที่บันทึก (Timestamp)",
        "เลขที่ใบงาน (Job Number)",
        "วันที่เข้าตรวจเช็ค (Service Date)",
        "ชื่อลูกค้า/โครงการ",
        "สถานที่ติดตั้ง",
        "ขนาดติดตั้ง (kWp)",
        "ประเภทบริการ",
        "ผู้ตรวจเช็ค/ช่างเทคนิค",
        "สถานะ",
        "ข้อเสนอแนะเพิ่มเติม",
        "ลิงก์ไฟล์ PDF (Google Drive Link)"
      ]);
      // Format headers
      sheet.getRange(1, 1, 1, 11).setFontWeight("bold").setBackground("#f1f5f9");
    }
    
    // 4. Append report metadata row
    var timestamp = new Date();
    sheet.appendRow([
      timestamp,
      metadata.jobNumber || "-",
      metadata.serviceDate || "-",
      metadata.customerName || "-",
      metadata.location || "-",
      metadata.systemSize || "-",
      metadata.serviceType || "-",
      metadata.technicians || "-",
      metadata.status || "-",
      metadata.recommendations || "-",
      fileUrl
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Report saved successfully!",
      folderUrl: firstFolderUrl,
      mainFolderUrl: mainFolder.getUrl(),
      fileUrl: fileUrl
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Google Apps Script Web App Endpoint for KKE Solar Maintenance Report
 * 
 * Instructions:
 * 1. Open https://script.google.com/
 * 2. Click "New Project" (or open existing project)
 * 3. Delete any default code and paste this script
 * 4. Click "Save" (disk icon)
 * 5. Click "Deploy" -> "New deployment" (or "Manage deployments" -> edit to create "New version")
 * 6. Select type: "Web app"
 * 7. Configure:
 *    - Description: Solar Report Sync & Database
 *    - Execute as: "Me" (your email)
 *    - Who has access: "Anyone" (crucial for API access)
 * 8. Click "Deploy", authorize permissions, and copy the "Web app URL"
 * 9. Paste this URL into the Settings modal of the Solar Maintenance app!
 */

// Google Drive folder ID shared by user
var FOLDER_ID = "1hEiKDf8VtQpIOOCX7kZxaXAn0e4TxpVT";

// Helper to read database JSON from Google Drive
function getReportsJson() {
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

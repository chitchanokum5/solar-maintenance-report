// ==========================================
// SOLAR CARE - APPLICATION JAVASCRIPT
// ==========================================

// Global State
let reports = [];
let currentImagesInverterRoom = [];
let currentImagesRooftop = [];
let currentCmImagesBefore = [];
let currentCmImagesAfter = [];
let editingReportId = null;
let maintenanceTypeChart = null;
let issueTypeChart = null;

function getSortTime(r) {
    if (r.createdAt) {
        return new Date(r.createdAt).getTime();
    }
    let counter = 0;
    const match = (r.id || "").match(/-(\d+)$/);
    if (match) {
        counter = parseInt(match[1], 10);
    }
    const baseTime = new Date(r.maintenanceDate || r.date || 0).getTime();
    return baseTime + (counter * 1000);
}

// ==========================================
// SHARED CLOUD DATABASE SYNC (SAFE MERGE & LOCAL FIRST)
// ==========================================
function getCloudEndpoint() {
    return localStorage.getItem("google_drive_webhook_url") || "https://script.google.com/macros/s/AKfycbyyPO7JYaPoit4tNtCwP9sYaSBbilcjda0fHeoUEbat4B1zEMX3UBK9uWVPoyREoY2X5Q/exec";
}
let isCloudSyncing = false;

// Global Loading Overlay & Progress Bar helpers
let globalProgressInterval = null;
let driveProgressInterval = null;

function showGlobalLoading(title = "กำลังดำเนินการ...", message = "โปรดรอสักครู่ ระบบกำลังดำเนินรายการ") {
    const overlay = document.getElementById("global-loading-overlay");
    const titleEl = document.getElementById("global-loading-title");
    const msgEl = document.getElementById("global-loading-message");
    const bar = document.getElementById("global-loading-progress-bar");
    const pct = document.getElementById("global-loading-percentage");
    
    if (overlay) {
        if (titleEl) titleEl.innerText = title;
        if (msgEl) msgEl.innerText = message;
        if (bar) bar.style.width = "0%";
        if (pct) pct.innerText = "0%";
        overlay.style.display = "flex";
    }
}

function updateGlobalProgress(percent) {
    const bar = document.getElementById("global-loading-progress-bar");
    const pct = document.getElementById("global-loading-percentage");
    if (bar) bar.style.width = `${percent}%`;
    if (pct) pct.innerText = `${percent}%`;
}

function animateGlobalProgress(targetPercent, durationMs = 1500) {
    if (globalProgressInterval) clearInterval(globalProgressInterval);
    
    const bar = document.getElementById("global-loading-progress-bar");
    const pct = document.getElementById("global-loading-percentage");
    if (!bar || !pct) return;
    
    const currentPercent = parseFloat(pct.innerText) || 0;
    const stepTime = 30; // 30ms steps
    const numSteps = durationMs / stepTime;
    const stepAmount = (targetPercent - currentPercent) / numSteps;
    let step = 0;
    
    globalProgressInterval = setInterval(() => {
        step++;
        let nextPercent = Math.min(targetPercent, Math.round(currentPercent + (step * stepAmount)));
        bar.style.width = `${nextPercent}%`;
        pct.innerText = `${nextPercent}%`;
        if (step >= numSteps || nextPercent >= targetPercent) {
            clearInterval(globalProgressInterval);
        }
    }, stepTime);
}

function hideGlobalLoading() {
    if (globalProgressInterval) clearInterval(globalProgressInterval);
    const overlay = document.getElementById("global-loading-overlay");
    if (overlay) {
        overlay.style.display = "none";
    }
}

function updateDriveProgress(percent) {
    const bar = document.getElementById("drive-sync-progress-bar");
    const pct = document.getElementById("drive-sync-percentage");
    if (bar) bar.style.width = `${percent}%`;
    if (pct) pct.innerText = `${percent}%`;
}

function animateDriveProgress(targetPercent, durationMs = 1500) {
    if (driveProgressInterval) clearInterval(driveProgressInterval);
    
    const bar = document.getElementById("drive-sync-progress-bar");
    const pct = document.getElementById("drive-sync-percentage");
    if (!bar || !pct) return;
    
    const currentPercent = parseFloat(pct.innerText) || 0;
    const stepTime = 30;
    const numSteps = durationMs / stepTime;
    const stepAmount = (targetPercent - currentPercent) / numSteps;
    let step = 0;
    
    driveProgressInterval = setInterval(() => {
        step++;
        let nextPercent = Math.min(targetPercent, Math.round(currentPercent + (step * stepAmount)));
        bar.style.width = `${nextPercent}%`;
        pct.innerText = `${nextPercent}%`;
        if (step >= numSteps || nextPercent >= targetPercent) {
            clearInterval(driveProgressInterval);
        }
    }, stepTime);
}

async function fetchSharedCloudReports(manualAlert = false) {
    if (isCloudSyncing) return;
    if (manualAlert) {
        showGlobalLoading("กำลังซิงค์ข้อมูล...", "ระบบกำลังดึงข้อมูลรายงานล่าสุดจาก Google Drive...");
        animateGlobalProgress(85, 2000);
    }
    let syncSuccess = false;
    try {
        const endpoint = getCloudEndpoint();
        const res = await fetch(endpoint + "?action=getReports&nocache=" + Date.now());
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
                const localMap = new Map(reports.map(r => [r.id, r]));
                let hasLocalUpdates = false;

                // Check if we have local reports not present in the remote data
                const remoteIds = new Set(data.map(r => r.id));
                reports.forEach(r => {
                    if (r && r.id && !remoteIds.has(r.id)) {
                        hasLocalUpdates = true;
                    }
                });

                data.forEach(remoteReport => {
                    if (remoteReport && remoteReport.id) {
                        const localReport = localMap.get(remoteReport.id);
                        if (localReport) {
                            // If local report has photos but remote doesn't (due to cloud size limits), preserve local photos
                            const hasLocalPhotos = (localReport.imagesInverterRoom && localReport.imagesInverterRoom.length > 0) || 
                                                 (localReport.imagesRooftop && localReport.imagesRooftop.length > 0) ||
                                                 (localReport.cmImagesBefore && localReport.cmImagesBefore.length > 0) ||
                                                 (localReport.cmImagesAfter && localReport.cmImagesAfter.length > 0);
                            
                            const hasRemotePhotos = (remoteReport.imagesInverterRoom && remoteReport.imagesInverterRoom.length > 0) || 
                                                   (remoteReport.imagesRooftop && remoteReport.imagesRooftop.length > 0) ||
                                                   (remoteReport.cmImagesBefore && remoteReport.cmImagesBefore.length > 0) ||
                                                   (remoteReport.cmImagesAfter && remoteReport.cmImagesAfter.length > 0);

                            if (hasLocalPhotos && !hasRemotePhotos) {
                                remoteReport.imagesInverterRoom = localReport.imagesInverterRoom;
                                remoteReport.imagesRooftop = localReport.imagesRooftop;
                                remoteReport.cmImagesBefore = localReport.cmImagesBefore;
                                remoteReport.cmImagesAfter = localReport.cmImagesAfter;
                            }
                        }
                        localMap.set(remoteReport.id, remoteReport);
                    }
                });

                reports = Array.from(localMap.values()).sort((a, b) => getSortTime(b) - getSortTime(a));

                saveReportsToLocalStorage();

                if (typeof updateDashboard === "function") updateDashboard();
                if (typeof renderHistoryTable === "function") renderHistoryTable();
                if (typeof renderCalendar === "function") renderCalendar();
                if (typeof renderSitesTable === "function") renderSitesTable();

                if (hasLocalUpdates) {
                    console.log("Local reports missing from Cloud. Uploading merged database...");
                    saveSharedCloudReports();
                }

                if (manualAlert) {
                    syncSuccess = true;
                    updateGlobalProgress(100);
                    setTimeout(() => {
                        hideGlobalLoading();
                        alert(`ซิงค์ข้อมูลสำเร็จ! ปัจจุบันมีรายงานในระบบรวมทั้งหมด ${reports.length} ฉบับ`);
                    }, 400);
                }
            }
        }
    } catch (e) {
        console.log("Shared Cloud fetch error:", e);
        if (manualAlert) {
            alert("ไม่สามารถเชื่อมต่อซิงค์ Cloud ได้ในขณะนี้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต");
        }
    } finally {
        if (manualAlert && !syncSuccess) hideGlobalLoading();
    }
}

async function saveSharedCloudReports() {
    isCloudSyncing = true;
    try {
        const endpoint = getCloudEndpoint();
        // Fetch current remote data first to prevent overwriting other technicians' reports
        const res = await fetch(endpoint + "?action=getReports&nocache=" + Date.now());
        let currentCloudReports = [];
        if (res.ok) {
            const remoteData = await res.json();
            if (Array.isArray(remoteData)) currentCloudReports = remoteData;
        }

        const mergedMap = new Map();
        currentCloudReports.forEach(r => { if (r && r.id) mergedMap.set(r.id, r); });
        reports.forEach(r => { if (r && r.id) mergedMap.set(r.id, r); });

        reports = Array.from(mergedMap.values());
        saveReportsToLocalStorage();

        await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action: "saveReports", reports: reports })
        });
    } catch (e) {
        console.log("Shared Cloud save error:", e);
    } finally {
        setTimeout(() => { isCloudSyncing = false; }, 2000);
    }
}

async function syncReportToCloud(report) {
    await saveSharedCloudReports();
}

async function deleteReportFromCloud(id) {
    await saveSharedCloudReports();
}

// Complete 63-item inspection list from KKE checklist PDF
const checklistMetadata = [
    // 1 PV Module & Mounting
    { key: "panelsCracks", section: "1 PV Module & Mounting", label: "PV Module ไม่มีรอยแตกร้าว", desc: "ตรวจสอบรอยแตกร้าว รอยบิ่น หรือความเสียหายกายภาพของกระจกแผง" },
    { key: "panelsDirt", section: "1 PV Module & Mounting", label: "ไม่มีฝุ่นหรือคราบสกปรกบน PV Module", desc: "คราบขี้นก ฝุ่นดินสะสม คราบใบไม้ หรือเงาบดบังแสงอาทิตย์", type: "warning" },
    { key: "panelsShifting", section: "1 PV Module & Mounting", label: "PV Module ไม่มีการเคลื่อนตัวและยึดแน่นทุกแผ่น", desc: "ตรวจสอบรางอลูมิเนียม ตัวจับยึดแผงไม่ขยับหลุดจากที่" },
    { key: "panelsMpptVolt", section: "1 PV Module & Mounting", label: "แรงดันไฟฟ้าแต่ละ MPPT อยู่ในเกณฑ์ปกติ", desc: "วัดค่าความต่างศักย์ไฟฟ้ากระแสตรงของทุก String" },
    { key: "panelsMpptCurrent", section: "1 PV Module & Mounting", label: "กระแสไฟฟ้าแต่ละ MPPT อยู่ในเกณฑ์ปกติ", desc: "วัดค่ากระแสไฟฟ้ากระแสตรงของทุก String" },
    { key: "panelsDcWiring", section: "1 PV Module & Mounting", label: "สายไฟ DC มีการเก็บสายไฟใต้ PV Module อยู่ในสภาพเรียบร้อย", desc: "การร้อยท่อเดินสายและการรัดสายไฟใต้แผงไม่ห้อยย้อยสัมผัสหลังคา" },
    { key: "panelsMc4", section: "1 PV Module & Mounting", label: "จุดเชื่อมต่อสายไฟ DC (MC4) เชื่อมต่อแน่นหนา ไม่ชำรุด", desc: "ขั้วต่อ MC4 ล็อคแน่นสนิท ปลอกหุ้มไม่กรอบแตกหัก" },
    { key: "panelsClamps", section: "1 PV Module & Mounting", label: "Middle Clamp & End Clamp ยึดแน่นและพร้อมใช้งาน", desc: "สุ่มตรวจเช็คความแน่นของการขันน็อตตัวยึดแผง" },
    { key: "panelsGround", section: "1 PV Module & Mounting", label: "Ground Cable ยึดแน่นหนา", desc: "สายกราวด์ของโครงสร้างรางยึดแผงเชื่อมต่อลงดินปกติ" },

    // 2 Array Junction Box
    { key: "ajbTerminalConn", section: "2 Array Junction Box", label: "จุดเชื่อมต่อสายไฟกับ Terminal ไม่มีจุดหลวมหรือจุดไหม้", desc: "ตรวจสอบด้วยสายตาและขันขั้วต่อในกล่องรวมสายไฟ DC" },
    { key: "ajbTerminalTemp", section: "2 Array Junction Box", label: "อุณหภูมิ Terminal ปกติ", desc: "วัดอุณหภูมิความร้อนสะสมบริเวณขั้วต่อด้วยกล้องเทอร์โมสแกน" },
    { key: "ajbFuseConn", section: "2 Array Junction Box", label: "จุดเชื่อมต่อสายไฟกับ DC Fuse ไม่มีจุดหลวมหรือจุดไหม้", desc: "ตรวจสอบความแน่นและรอยเขม่าของฐานฟิวส์กระแสตรง" },
    { key: "ajbFuseTemp", section: "2 Array Junction Box", label: "อุณหภูมิ DC Fuse ปกติ", desc: "ตรวจจับความร้อนสะสมของชุดฟิวส์ขณะระบบทำงาน" },
    { key: "ajbSpdConn", section: "2 Array Junction Box", label: "จุดเชื่อมต่อสายไฟกับ DC Surge Protection Devices ไม่มีจุดหลวมหรือจุดไหม้", desc: "ตรวจสอบขั้วต่อสายไฟของตัวกันฟ้าผ่ากระแสตรง" },
    { key: "ajbSpdTemp", section: "2 Array Junction Box", label: "อุณหภูมิ DC Surge ปกติ", desc: "ตรวจสอบความร้อนสะสมของตัวอุปกรณ์ป้องกันฟ้าผ่า" },
    { key: "ajbSwitchConn", section: "2 Array Junction Box", label: "จุดเชื่อมต่อสายไฟกับ DC Switch ไม่มีจุดหลวมหรือจุดไหม้", desc: "ตรวจสอบสายเชื่อมต่อสวิตช์ตัดตอนกระแสตรง (DC Isolator)" },
    { key: "ajbSwitchTemp", section: "2 Array Junction Box", label: "อุณหภูมิ DC Switch ปกติ", desc: "ตรวจอุณหภูมิสะสมขณะเปิดระบบของสวิตช์ตัดตอน" },
    { key: "ajbCleanliness", section: "2 Array Junction Box", label: "ความสะอาดภายในและบริเวณรอบๆ Array Junction Box", desc: "ทำความสะอาดฝุ่น คราบแมลง หรือน้ำขังในกล่องรวมสาย", type: "warning" },

    // 3 Inverter
    { key: "inverterTemp", section: "3 Inverter", label: "อุณหภูมิ Inverter และระบบระบายความร้อนปกติ", desc: "พัดลมทำงานปกติ ครีบระบายความร้อนไม่ตัน อุณหภูมิอยู่ในเกณฑ์" },
    { key: "inverterMc4", section: "3 Inverter", label: "จุดเชื่อมต่อ MC4 เชื่อมต่อแน่นหนา ไม่มีจุดชำรุดเสียหาย", desc: "ตรวจสอบสาย DC ขาเข้าใต้เครื่องอินเวอร์เตอร์แน่นกระชับ" },

    // 4 Solar MDB
    { key: "mdbMainMccbConn", section: "4 Solar MDB", label: "จุดเชื่อมต่อสายไฟกับ Main MCCB ไม่มีจุดหลวมหรือจุดไหม้", desc: "ตรวจสอบจุดขันเชื่อมต่อสายไฟฟ้ากระแสสลับหลัก" },
    { key: "mdbMainMccbTemp", section: "4 Solar MDB", label: "อุณหภูมิ Main MCCB ปกติ", desc: "ใช้เทอร์โมสแกนตรวจจับจุดพิกัดความร้อนที่ตัวเบรกเกอร์หลัก" },
    { key: "mdbSpdConn", section: "4 Solar MDB", label: "จุดเชื่อมต่อสายไฟกับ AC Surge Protection Devices ไม่มีจุดหลวมหรือจุดไหม้", desc: "ตรวจสอบจุดยึดสายไฟอุปกรณ์ป้องกันไฟกระชากกระแสสลับ" },
    { key: "mdbSpdTemp", section: "4 Solar MDB", label: "อุณหภูมิ AC Surge Protection Devices ปกติ", desc: "ตรวจสอบการทำงานและความร้อนของตัวป้องกันฟ้าผ่า AC" },
    { key: "mdbBranchMccbConn", section: "4 Solar MDB", label: "จุดเชื่อมต่อสายไฟกับ Branch MCCB ไม่มีจุดหลวมหรือจุดไหม้", desc: "ตรวจสอบขั้วต่อสายไฟของเบรกเกอร์สาขาย่อยภายในตู้" },
    { key: "mdbBranchMccbTemp", section: "4 Solar MDB", label: "อุณหภูมิ Branch MCCB ปกติ", desc: "ตรวจจับความร้อนสะสมของชุดตัวนำกระแสเบรกเกอร์ย่อย" },
    { key: "mdbSelector", section: "4 Solar MDB", label: "Selector Switch อยู่ในสภาพพร้อมใช้งาน", desc: "สวิตช์บิดเลือกเฟสแสดงผลปกติ หมุนได้นิ่มนวลไม่ติดขัด" },
    { key: "mdbPqMeter", section: "4 Solar MDB", label: "PQ Meter อยู่ในสภาพพร้อมใช้งาน", desc: "หน้าจอมิเตอร์วัดค่าไฟฟ้าหลักเปิดสว่าง แสดงข้อมูลถูกต้องปกติ" },
    { key: "mdbCleanliness", section: "4 Solar MDB", label: "ความสะอาดภายในและบริเวณรอบๆ Solar MDB", desc: "ทำความสะอาดปัดฝุ่น คราบเขม่า และตรวจดูการซีลช่องทางเดินสายไฟ", type: "warning" },

    // 5 Rapid Shutdown
    { key: "rsdIntact", section: "5 Rapid Shutdown", label: "อุปกรณ์อยู่ในสภาพพร้อมใช้งาน ไม่ชำรุดเสียหาย (เกิดการไหม้)", desc: "ตรวจสภาพภายนอกกล่องตัดไฟด่วนบนหลังคาไม่มีควันหรือคราบเขม่า" },
    { key: "rsdMounting", section: "5 Rapid Shutdown", label: "อุปกรณ์ไม่ตกหล่นจากจุดยึดเกาะและตกสัมผัสกับหลังคา", desc: "ตรวจสอบการยึดตัว RSD กับรางแผงไม่ให้ห้อยมาทับกระเบื้องหลังคา" },
    { key: "rsdCableClip", section: "5 Rapid Shutdown", label: "อุปกรณ์ยึดเกาะ (Cable Clip RSD) อยู่สภาพพร้อมใช้งาน", desc: "ตรวจสภาพคลิปหนีบสายไม่ผุกร่อนหรือแตกเสียหาย" },
    { key: "rsdSaltStain", section: "5 Rapid Shutdown", label: "อุปกรณ์ Connector ของ RSD อยู่ในสภาพพร้อมใช้งาน (ไม่มีคราบเกลือ)", desc: "ตรวจสอบสภาพขั้วต่อสายไม่เปียกชื้นหรือมีสนิมเกลือสีขาวเกาะ" },
    { key: "rsdConnRsd", section: "5 Rapid Shutdown", label: "Connector สำหรับเชื่อมต่อ RSD (ไฟเลี้ยง) แน่นหนา", desc: "ตรวจสอบขั้วสัญญาณควบคุมไฟเลี้ยงระบบ Rapid Shutdown" },
    { key: "rsdConnPv", section: "5 Rapid Shutdown", label: "Connector สำหรับเชื่อมต่อ PV Module (2:1 หรือ 1:1) ปกติ", desc: "ตรวจสอบความสมบูรณ์ของจุดต่อเชื่อมกับสายไฟแผงโซล่าเซลล์" },
    { key: "rsdTemp", section: "5 Rapid Shutdown", label: "ตรวจวัดอุณหภูมิ ของตัวอุปกรณ์ปกติ", desc: "ใช้กล้องตรวจวัดอุณหภูมิสะสมของเครื่อง RSD ขณะเปิดสแตนด์บาย" },
    { key: "rsdVoltageRange", section: "5 Rapid Shutdown", label: "แรงดันไฟเลี้ยงทำงานปกติ (อยู่ระหว่าง 22.0 - 28.0 Vdc)", desc: "วัดแรงดันไฟฟ้าสายคอนโทรลของระบบ Rapid shutdown" },
    { key: "rsdVoltageString", section: "5 Rapid Shutdown", label: "ในสภาวะที่ทำงานได้ แรงดันของแผงที่อนุกรมกันมาเป็นปกติ", desc: "ตรวจสอบ String Voltage เมื่อปิดสวิตช์ Emergency สัญญาณแรงดันต้องลดลงตามเกณฑ์" },

    // 6 Optimizer
    { key: "optIntact", section: "6 Optimizer", label: "ไม่ชำรุดเสียหาย (ไม่เกิดการไหม้ของตัวอุปกรณ์)", desc: "ตรวจเช็คอุณหภูมิและสภาพกล่องบ่มกำลังไฟฟ้าใต้แผงโซล่า" },
    { key: "optMounting", section: "6 Optimizer", label: "อุปกรณ์ไม่ตกหล่นจากจุดยึดเกาะและตกสัมผัสกับหลังคา", desc: "ตรวจสอบโครงยึดตัวเครื่อง Optimizer ยึดแน่นกับเฟรมราง" },
    { key: "optCableClip", section: "6 Optimizer", label: "อุปกรณ์ยึดเกาะ (Cable Clip) อยู่สภาพพร้อมใช้งานไม่ชำรุด", desc: "ตรวจสภาพความแข็งแรงของคลิปรัดล็อคสายไฟเครื่อง" },
    { key: "optConnector", section: "6 Optimizer", label: "อุปกรณ์ Connector ของ Optimizer อยู่ในสภาพพร้อมใช้งาน (ไม่มีคราบเกลือ)", desc: "ขั้วต่อ MC4 ของตัวเครื่องสะอาด แห้ง และเสียบแน่นกระชับ" },
    { key: "optConnOpt", section: "6 Optimizer", label: "Connector Optimizer แน่นหนา", desc: "ตรวจขั้วสัญญาณและจุดเชื่อมต่อสายไฟฟ้าหลักของเครื่อง" },
    { key: "optVoltage", section: "6 Optimizer", label: "แรงดันไฟฟ้าขาออกทำงานปกติ (1.00 Vdc ต่อตัว)", desc: "สุ่มวัดแรงดันตอนปิดสวิตช์ระบบ (Safety Voltage 1V)" },

    // 7 Control Box RSD (Emergency)
    { key: "ctrlClean", section: "7 Control Box RSD (Emergency)", label: "อุปกรณ์อยู่ในสภาพพร้อมใช้งาน (ไม่สกปรก)", desc: "ตู้ควบคุมและปุ่ม Emergency สภาพภายนอกสะอาดพร้อมใช้งาน", type: "warning" },
    { key: "ctrlMounting", section: "7 Control Box RSD (Emergency)", label: "จุดติดตั้ง บริเวณ Connector อยู่ในสภาพพร้อมใช้งาน ไม่แตกหัก", desc: "เคเบิ้ลแกลนด์และจุดนำสายไฟเข้าออกตู้ล็อคแน่นหนา" },
    { key: "ctrlVoltIn", section: "7 Control Box RSD (Emergency)", label: "แรงดันไฟฟ้าขาเข้า 220 Vac มาปกติ", desc: "วัดค่าความต่างศักย์ไฟฟ้าฝั่งสวิตชิ่งกระแสสลับในตู้ควบคุม" },
    { key: "ctrlVoltOut", section: "7 Control Box RSD (Emergency)", label: "แรงดันไฟฟ้าขาออกมีแรงดันที่มากกว่า 24 Vdc", desc: "วัดค่าแรงดันไฟฟ้ากระแสตรงขาออกสำหรับจ่ายเลี้ยงตัว RSD บนหลังคา" },
    { key: "ctrlEmergencyTest", section: "7 Control Box RSD (Emergency)", label: "ทดสอบปุ่ม Emergency เพื่อตัดวงจรของ RSD", desc: "ทดลองกดปุ่มสีแดงเพื่อสับตัดไฟด่วน และเช็คสถานะการตัดจ่ายไฟ" },
    { key: "ctrlTerminal", section: "7 Control Box RSD (Emergency)", label: "จุดหลวมและเชื่อมต่อ Terminal ของทั้งขาเข้าและขาออกปกติ", desc: "ตรวจความแน่นของน็อตจับยึดสายบนรางเทอร์มินอลในตู้" },

    // 8 Weather Station
    { key: "weatherPhysical", section: "8 Weather Station ( Smart Logger )", label: "ไม่ชำรุดเสียหายแตกหักของตัวอุปกรณ์", desc: "สภาพภายนอกของชุดเครื่องมือวัดลม ฝน และแสงแดดสมบูรณ์" },
    { key: "weatherSensorClean", section: "8 Weather Station ( Smart Logger )", label: "Sensor ตัวรับค่าของ Weather station อยู่ในสภาพพร้อมใช้งาน ไม่สกปรก", desc: "เช็ดทำความสะอาดหน้าปัดเซนเซอร์วัดค่าความเข้มแสงอาทิตย์", type: "warning" },
    { key: "weatherTerminal", section: "8 Weather Station ( Smart Logger )", label: "จุดเชื่อมต่อ ของ Terminal ของสาย RS485 อยู่ในสภาพพร้อมใช้งาน", desc: "ขั้วต่อสายสัญญาณข้อมูล Modbus RS485 ยึดแน่นดี" },
    { key: "weatherConverter", section: "8 Weather Station ( Smart Logger )", label: "อุปกรณ์ชุดแปลงข้อมูลอยู่ในสภาพที่พร้อมใช้งาน", desc: "โมดูลแปลงสัญญาณไฟฟ้าสว่างปกติดี ไม่ขึ้นสถานะ Error" },
    { key: "weatherSignalOut", section: "8 Weather Station ( Smart Logger )", label: "แรงดันสัญญาณขาออก จากตัวอุปกรณ์ที่ใช้สื่อสารกับ Smart Logger ปกติ (4-20 mA)", desc: "วัดค่ากระแสไฟฟ้าของสายสัญญาณหลูปอนาล็อก" },
    { key: "weatherSignalIn", section: "8 Weather Station ( Smart Logger )", label: "แรงดันสัญญาณขาเข้า Smart Logger ปกติ (4-20 mA)", desc: "ตรวจสอบไฟเลี้ยงและระดับสัญญาณที่บอร์ดควบคุมส่วนกลาง" },
    { key: "weatherSupport", section: "8 Weather Station ( Smart Logger )", label: "โครงสร้าง Support ของตัวอุปกรณ์ อยู่ในสภาพที่สมบูรณ์ไม่ชำรุด", desc: "เสาขาตั้งเหล็กรับเซนเซอร์ยึดกับพิก้นดาดฟ้าแข็งแรงแน่นหนา" },
    { key: "weatherCalib", section: "8 Weather Station ( Smart Logger )", label: "อุปกรณ์มีการใช้งานครบ 2 ปี ควรนำไป Calibration", desc: "ตรวจสอบวันหมดอายุของใบเซอร์การสอบเทียบเซนเซอร์วัดแดด", type: "warning" },

    // 9 Water System
    { key: "waterPumpUsable", section: "9 Water System", label: "ปั๊มน้ำสามารถใช้งานได้และระบบทำงานปกติ", desc: "ทดลองเปิดน้ำล้างแผง ปั๊มเดินเรียบ แรงดันน้ำกระจายปกติ", type: "warning" },
    { key: "waterPumpRun", section: "9 Water System", label: "ปั๊มน้ำสามารถทำงานได้ (ทดสอบมอเตอร์)", desc: "ตรวจสอบทิศทางการหมุน กระแสไฟฟ้า และอุณหภูมิของตัวมอเตอร์ปั๊ม", type: "warning" },
    { key: "waterCabinet", section: "9 Water System", label: "ตู้ควบคุมปั๊มน้ำไม่แตกหัก ไม่มีสิ่งผิดปกติภายใน", desc: "ตรวจสอบซีลยางขอบตู้ สภาพสลักประตูปิดสนิท ป้องกันน้ำสาดปกติ" },
    { key: "waterCabinetDevice", section: "9 Water System", label: "อุปกรณ์ภายในตู้สามารถใช้งานได้ (Magnetic/Overload)", desc: "ตรวจสอบสถานะแมกเนติกคอนแทกเตอร์และชุดป้องกันมอเตอร์ไหม้" },
    { key: "waterPipes", section: "9 Water System", label: "ท่อน้ำสามารถใช้งานได้ ไม่แตกหัก ไม่รั่วซึม", desc: "เดินตรวจเช็คท่อน้ำรอบแถวแผงโซล่าเซลล์ หัวสปริงเกลอร์ไม่ตันและไม่แตกหัก", type: "warning" }
];

// Mock Data to initialize the dashboard with beautiful contents
const mockReports = [
    {
        id: "SR-20260702-001",
        customerName: "โรบินสัน ไลฟ์สไตล์ (ศรีสมาน)",
        technicianName: "",
        location: "นนทบุรี",
        systemSize: 120.0,
        maintenanceDate: "2026-07-02",
        maintenanceType: "Preventive Maintenance",
        inverters: [{
            name: "Inverter 1",
            model: "Huawei SUN2000-100KTL-M1",
            pvVoltage: 580,
            pvCurrent: 11.2,
            acPower: 92.5,
            inverterTemp: 52,
            ajbTemp: 46
        }],
        acPower: 92.5,
        checks: {},
        efficiency: 92,
        status: "Normal",
        recommendations: "ล้างแผงโซล่าเซลล์ประจำไตรมาสที่ 2 เรียบร้อย ตรวจเช็คจุดเชื่อมต่อไฟฟ้าปกติ ประสิทธิภาพฟื้นฟูขึ้นมาอยู่ในเกณฑ์มาตรฐานแนะนำตรวจเช็คซ้ำอีกครั้งในอีก 3 เดือน",
        imagesInverterRoom: [],
        imagesRooftop: []
    },
    {
        id: "SR-20260710-002",
        customerName: "บ้านเดี่ยว คุณปัญญา (หมู่บ้านเศรษฐสิริ)",
        technicianName: "",
        location: "กรุงเทพฯ",
        systemSize: 10.0,
        maintenanceDate: "2026-07-10",
        maintenanceType: "Preventive Maintenance",
        inverters: [{
            name: "Inverter 1",
            model: "Huawei SUN2000-10KTL-M1",
            pvVoltage: 360,
            pvCurrent: 8.5,
            acPower: 8.8,
            inverterTemp: 42,
            ajbTemp: 39
        }],
        acPower: 8.8,
        checks: {},
        efficiency: 98,
        status: "Excellent",
        recommendations: "ระบบทำงานสมบูรณ์ดีมาก แผงไม่มีคราบฝุ่นหนา ไม่มีเงาบังหน้าแผง ค่าไฟฟ้าปกติ อินเวอร์เตอร์ทำงานเต็มกำลังการผลิต",
        imagesInverterRoom: [],
        imagesRooftop: []
    },
    {
        id: "SR-20260715-003",
        customerName: "โรงงานอุตสาหกรรม ไทยฟู้ดส์",
        technicianName: "วิชัย บริการดี",
        location: "ชลบุรี",
        systemSize: 350.0,
        maintenanceDate: "2026-07-15",
        maintenanceType: "Corrective Maintenance",
        inverters: [
            { name: "Inverter 1", model: "Huawei SUN2000-100KTL-M1", pvVoltage: 620, pvCurrent: 7.2, acPower: 92.0, inverterTemp: 64, ajbTemp: 58 },
            { name: "Inverter 2", model: "Huawei SUN2000-100KTL-M1", pvVoltage: 610, pvCurrent: 7.1, acPower: 93.0, inverterTemp: 65, ajbTemp: 59 }
        ],
        acPower: 185.0,
        checks: {
            panelsDirt: "Fix",
            inverterTemp: "Fix",
            rsdCableClip: "Fix"
        },
        checkRemarks: {
            panelsDirt: "ฝุ่นเขม่าอุตสาหกรรมสะสมหนาแน่นและมีคราบขี้นกเกาะหน้าแผงจำนวนมาก",
            inverterTemp: "อุณหภูมิอินเวอร์เตอร์สูง 64 องศา ครีบและพัดลมระบายอากาศเริ่มอุดตันด้วยฝุ่นแป้ง",
            rsdCableClip: "พบท่อร้อยสาย DC โซน D ชำรุดแตกหัก และสายไฟห้อยย้อยสัมผัสหลังคา"
        },
        efficiency: 68,
        status: "Needs Maintenance",
        recommendations: "1. ตรวจพบฝุ่นและคราบขี้นกหนาแน่นบนแผงโซล่าเซลล์ (แนะนำให้ทำการล้างแผงด่วนเพื่อกู้คืนประสิทธิภาพ)\n2. ท่อร้อยสายไฟ (Conduit) โซน D แตกหักจนเห็นสายไฟกระแสตรงเปลือย แนะนำให้เปลี่ยนท่อร้อยสายใหม่\n3. อินเวอร์เตอร์เครื่องที่ 2 แจ้งเตือน Over-temperature เล็กน้อย เนื่องจากมีฝุ่นสะสมในแผงระบายความร้อน ได้ทำการเป่าทำความสะอาดเบื้องต้นแล้ว",
        imagesInverterRoom: [],
        imagesRooftop: []
    }
];

// LocalStorage Auto-healing & Quota Management Save Helper
function saveReportsToLocalStorage() {
    try {
        localStorage.setItem("solar_reports", JSON.stringify(reports));
        console.log("Saved reports to localStorage successfully. Count:", reports.length);
    } catch (e) {
        if (e.name === "QuotaExceededError" || e.code === 22) {
            console.warn("LocalStorage quota exceeded! Automatically cleaning up images from older reports to free up space...");
            
            // Keep images only for the first 2 reports in the array (newest first)
            for (let i = 0; i < reports.length; i++) {
                if (i >= 2) {
                    reports[i].cmImagesBefore = [];
                    reports[i].cmImagesAfter = [];
                    reports[i].imagesInverterRoom = [];
                    reports[i].imagesRooftop = [];
                }
            }
            
            try {
                localStorage.setItem("solar_reports", JSON.stringify(reports));
                console.log("Successfully saved cleaned reports to LocalStorage.");
            } catch (err) {
                console.error("LocalStorage still full after clean. Stripping all report images.", err);
                
                // Strip all images from reports
                for (let i = 0; i < reports.length; i++) {
                    reports[i].cmImagesBefore = [];
                    reports[i].cmImagesAfter = [];
                    reports[i].imagesInverterRoom = [];
                    reports[i].imagesRooftop = [];
                }
                
                try {
                    localStorage.setItem("solar_reports", JSON.stringify(reports));
                } catch (finalErr) {
                    console.error("Critical: LocalStorage is completely full and cannot save anything.", finalErr);
                    alert("พื้นที่จัดเก็บข้อมูลบนเครื่องนี้เต็ม! ไม่สามารถบันทึกข้อมูลได้ กรุณาลบข้อมูลประวัติของบราวเซอร์เพื่อเคลียร์พื้นที่");
                }
            }
        } else {
            console.error("LocalStorage write error:", e);
        }
    }
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
    // 1. Load Data from LocalStorage
    const storedReports = localStorage.getItem("solar_reports");
    if (storedReports) {
        reports = JSON.parse(storedReports);
    } else {
        // Initialize mock check status
        mockReports.forEach(r => {
            checklistMetadata.forEach(m => {
                if (!r.checks[m.key]) {
                    r.checks[m.key] = "Pass";
                }
            });
        });
        reports = [...mockReports];
    }

    saveReportsToLocalStorage();

    // Live Shared Cloud Database Sync & Auto-polling
    fetchSharedCloudReports();
    setInterval(fetchSharedCloudReports, 5000);

    // Set Default Date in form to today
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById("maintenance-date").value = todayStr;

    // Display Current Date in Header
    updateHeaderDate();

    // 2. Initialize UI Components & Charts
    initTabs();
    initCharts();
    updateDashboard();
    renderReportsTable();
    initFormHandlers();
    initImageUpload();
    initSearchAndFilter();

    // Toggle PM vs CM form sections based on maintenance type
    const maintTypeSelect = document.getElementById("maintenance-type");
    if (maintTypeSelect) {
        const handleTypeToggle = () => {
            const isCm = maintTypeSelect.value === "Corrective Maintenance";
            const pmWrapper = document.getElementById("pm-checklist-section-wrapper");
            const cmWrapper = document.getElementById("cm-repair-section-wrapper");
            const invWrapper = document.getElementById("inverter-parameters-section-wrapper");
            const photoWrapper = document.getElementById("general-photos-section-wrapper");

            if (pmWrapper) pmWrapper.style.display = isCm ? "none" : "block";
            if (cmWrapper) cmWrapper.style.display = isCm ? "block" : "none";
            if (invWrapper) invWrapper.style.display = isCm ? "none" : "block";
            if (photoWrapper) photoWrapper.style.display = isCm ? "none" : "block";
        };
        maintTypeSelect.addEventListener("change", handleTypeToggle);
        handleTypeToggle();
    }

    // Theme Switcher Event Listener (3 Theme Templates)
    const themeSelect = document.getElementById("theme-switcher-select");
    if (themeSelect) {
        const savedTheme = localStorage.getItem("kke_theme_preference") || "kke-brand";
        themeSelect.value = savedTheme;
        document.body.setAttribute("data-theme", savedTheme);

        themeSelect.addEventListener("change", (e) => {
            const theme = e.target.value;
            document.body.setAttribute("data-theme", theme);
            localStorage.setItem("kke_theme_preference", theme);
        });
    }

    // Manual Cloud Sync Button listener
    const syncCloudBtn = document.getElementById("btn-manual-sync-cloud");
    if (syncCloudBtn) {
        syncCloudBtn.addEventListener("click", () => {
            syncCloudBtn.disabled = true;
            syncCloudBtn.querySelector("span").innerText = "กำลังซิงค์...";
            fetchSharedCloudReports(true).finally(() => {
                syncCloudBtn.disabled = false;
                syncCloudBtn.querySelector("span").innerText = "ซิงค์รายงาน";
            });
        });
    }

    // Layout Structure Switcher (3 Layout Templates)
    const layoutSelect = document.getElementById("layout-switcher-select");
    if (layoutSelect) {
        const savedLayout = localStorage.getItem("kke_layout_preference") || "default";
        layoutSelect.value = savedLayout;
        document.body.setAttribute("data-layout", savedLayout);

        layoutSelect.addEventListener("change", (e) => {
            const layout = e.target.value;
            document.body.setAttribute("data-layout", layout);
            localStorage.setItem("kke_layout_preference", layout);
        });
    }

    // Print Color Mode Selector
    const printColorSelect = document.getElementById("print-color-mode-select");
    if (printColorSelect) {
        printColorSelect.addEventListener("change", (e) => {
            if (e.target.value === "bw") {
                document.body.classList.add("print-bw-mode");
            } else {
                document.body.classList.remove("print-bw-mode");
            }
        });
    }

    // Cancel Edit Button event handler
    const cancelEditBtn = document.getElementById("btn-cancel-edit-mode");
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener("click", (e) => {
            e.preventDefault();
            cancelEditMode();
        });
    }

    // Render Dynamic Checklist Form
    renderFormChecklist();

    // Initialize default inverter input
    addInverterInput("Inverter 1");

    // Mobile Navigation Toggle
    const mobileMenuBtn = document.getElementById("btn-mobile-menu");
    const sidebarOverlay = document.getElementById("sidebar-overlay");
    const sidebar = document.querySelector(".sidebar");
    
    if (mobileMenuBtn && sidebarOverlay && sidebar) {
        const toggleSidebar = () => {
            sidebar.classList.toggle("open");
            sidebarOverlay.classList.toggle("active");
        };
        
        const closeSidebar = () => {
            sidebar.classList.remove("open");
            sidebarOverlay.classList.remove("active");
        };
        
        mobileMenuBtn.addEventListener("click", toggleSidebar);
        sidebarOverlay.addEventListener("click", closeSidebar);
        
        // Auto-close sidebar on item selection
        const navItems = document.querySelectorAll(".nav-item");
        navItems.forEach(item => {
            item.addEventListener("click", () => {
                closeSidebar();
            });
        });
    }

    // Initialize Lucide Icons
    lucide.createIcons();
});

// Update Current Live Date in Topbar
function updateHeaderDate() {
    const months = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];
    const d = new Date();
    const formatted = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
    document.getElementById("live-date").innerText = formatted;
}

// Tab Switch Logic
function initTabs() {
    const navItems = document.querySelectorAll(".nav-item");
    const tabContents = document.querySelectorAll(".tab-content");
    const currentTitle = document.getElementById("current-tab-title");
    const currentSubtitle = document.getElementById("current-tab-subtitle");

    const tabMeta = {
        "dashboard": { title: "แดชบอร์ดสรุปผล", subtitle: "ภาพรวมระบบและการตรวจเช็คล่าสุด" },
        "new-report": { title: "สร้างรายงานซ่อมบำรุง", subtitle: "กรอกข้อมูลรายละเอียดการเข้าตรวจเช็คหน้างาน" },
        "history": { title: "ประวัติการซ่อมบำรุง", subtitle: "ตารางสรุปรายการตรวจซ่อมโซล่าเซลล์ที่ผ่านมาทั้งหมด" },
        "team": { title: "รายชื่อทีมงาน O&M", subtitle: "ผังวิศวกร ช่างเทคนิค และบุคลากรทีม Operation and Maintenance (12 ท่าน)" },
        "sites": { title: "รายชื่อไซต์งานทั้งหมด", subtitle: "ตารางสรุปรายชื่อไซต์งานระบบโซล่าเซลล์ 156 แห่ง" },
        "calendar": { title: "ปฏิทินการเข้าตรวจเช็คระบบ", subtitle: "บันทึกและแสดงกำหนดการออกรายงานประจำวันและรายเดือน" },
        "report-view": { title: "เอกสารรายงานผล", subtitle: "มุมมองเพื่อพิมพ์รายงานหรือบันทึกไฟล์เป็น PDF" }
    };

    let currentTabId = "dashboard";
    let previousTabId = "dashboard";

    function switchTab(tabId) {
        window.scrollTo(0, 0);

        if (tabId !== "report-view" && tabId !== currentTabId) {
            previousTabId = (currentTabId === "new-report") ? "history" : currentTabId;
        }
        currentTabId = tabId;

        // Toggle active tabs
        tabContents.forEach(tab => {
            tab.classList.remove("active");
            if (tab.id === `tab-${tabId}`) tab.classList.add("active");
        });

        // Toggle active menu items
        navItems.forEach(item => {
            item.classList.remove("active");
            if (item.getAttribute("data-tab") === tabId) item.classList.add("active");
        });
        const topNavItems = document.querySelectorAll(".top-nav-item");
        topNavItems.forEach(item => {
            item.classList.remove("active");
            if (item.getAttribute("data-tab") === tabId) item.classList.add("active");
        });

        // Update titles
        if (tabMeta[tabId]) {
            currentTitle.innerText = tabMeta[tabId].title;
            currentSubtitle.innerText = tabMeta[tabId].subtitle;
        }

        // Specific actions per tab
        if (tabId === "dashboard") {
            updateDashboard();
            fetchSharedCloudReports(false);
        } else if (tabId === "history") {
            renderHistoryTable();
            fetchSharedCloudReports(false);
        } else if (tabId === "team") {
            renderTeamGrid();
        } else if (tabId === "sites") {
            renderSitesTable();
            fetchSharedCloudReports(false);
        } else if (tabId === "calendar") {
            renderCalendar();
            fetchSharedCloudReports(false);
        }
    }

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const tabId = item.getAttribute("data-tab");
            switchTab(tabId);
        });
    });

    // Quick Action button in header
    document.getElementById("quick-create-btn").addEventListener("click", () => switchTab("new-report"));
    document.getElementById("view-all-reports-link").addEventListener("click", () => switchTab("history"));
    
    // Back to list button from print preview (returns to whatever tab user came from)
    document.getElementById("btn-back-to-list").addEventListener("click", () => {
        switchTab(previousTabId || "history");
    });

    // Make switchTab available globally
    window.switchTab = switchTab;
}

// Update Dashboard KPIs and Charts Data
function updateDashboard() {
    const totalReports = reports.length;
    
    let issuesCount = 0;
    let reportsWithFixesCount = 0;
    let totalSize = 0;

    const now = new Date();
    const currentY = now.getFullYear();
    const currentM = now.getMonth();

    let thisMonthVisitsCount = 0;
    const visitedSitesThisMonth = new Set();

    reports.forEach(r => {
        const sizeNum = parseFloat(r.systemSize) || 0;
        totalSize += sizeNum;
        
        let hasFix = false;
        if (r.checks) {
            Object.values(r.checks).forEach(val => {
                if (val === "Fix") {
                    issuesCount++;
                    hasFix = true;
                }
            });
        }

        if (hasFix || r.cmRepairStatus === "In Progress" || r.cmRepairStatus === "Pending Parts") {
            reportsWithFixesCount++;
        }

        const rawDate = r.maintenanceDate || r.date || r.createdAt;
        if (rawDate) {
            const d = parseReportDate(rawDate);
            if (d && !isNaN(d.getTime())) {
                if (d.getFullYear() === currentY && d.getMonth() === currentM) {
                    thisMonthVisitsCount++;
                    if (r.customerName) visitedSitesThisMonth.add(r.customerName.trim().toLowerCase());
                }
            }
        }
    });

    const uniqueMonthSites = visitedSitesThisMonth.size;
    const monthVisitsVal = `${uniqueMonthSites || thisMonthVisitsCount} ไซต์`;
    const formattedTotalPower = totalSize > 0 
        ? `${totalSize.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWp`
        : "0.0 kWp";

    const kpiTotalReportsEl = document.getElementById("kpi-total-reports");
    const kpiIssuesFoundEl = document.getElementById("kpi-issues-found");
    const kpiMonthVisitsEl = document.getElementById("kpi-month-visits");
    const kpiMonthLabelEl = document.getElementById("kpi-month-visits-label");
    const kpiTeamCountEl = document.getElementById("kpi-team-count");

    const teamSize = (typeof teamMembers !== "undefined" && Array.isArray(teamMembers)) ? teamMembers.length : 12;

    if (kpiTotalReportsEl) kpiTotalReportsEl.innerText = totalReports;
    if (kpiIssuesFoundEl) kpiIssuesFoundEl.innerText = reportsWithFixesCount;
    if (kpiMonthVisitsEl) kpiMonthVisitsEl.innerText = monthVisitsVal;
    if (kpiMonthLabelEl) kpiMonthLabelEl.innerText = `ประจำเดือน ${thaiMonthNames[currentM]} ${currentY + 543}`;
    if (kpiTeamCountEl) kpiTeamCountEl.innerText = `${teamSize} ท่าน`;

    const heroTotalReportsEl = document.getElementById("hero-total-reports");
    const heroIssuesFoundEl = document.getElementById("hero-issues-found");
    const heroMonthVisitsEl = document.getElementById("hero-month-visits");
    const heroTeamCountEl = document.getElementById("hero-team-count");

    if (heroTotalReportsEl) heroTotalReportsEl.innerText = totalReports;
    if (heroIssuesFoundEl) heroIssuesFoundEl.innerText = reportsWithFixesCount;
    if (heroMonthVisitsEl) heroMonthVisitsEl.innerText = monthVisitsVal;
    if (heroTeamCountEl) heroTeamCountEl.innerText = `${teamSize} ท่าน`;

    const trendEl = document.getElementById("kpi-issue-trend");
    if (trendEl) {
        if (reportsWithFixesCount > 0) {
            trendEl.className = "trend negative";
            trendEl.innerHTML = `<i data-lucide="alert-triangle"></i> พบรายการต้องแก้ไข`;
        } else {
            trendEl.className = "trend positive";
            trendEl.innerHTML = `<i data-lucide="shield-check"></i> ปกติ`;
        }
    }

    if (window.lucide) lucide.createIcons();

    renderReportsTable();
    updateChartsData();
}

// Chart.js Setup
function initCharts() {
    const ctxType = document.getElementById("maintenanceTypeChart").getContext("2d");
    maintenanceTypeChart = new Chart(ctxType, {
        type: 'bar',
        data: {
            labels: ['Preventive Maintenance', 'Corrective Maintenance'],
            datasets: [{
                label: 'จำนวนใบงาน (งาน)',
                data: [0, 0],
                backgroundColor: ['#06b6d4', '#ef4444'],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', stepSize: 1 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { family: 'Sarabun' } }
                }
            }
        }
    });

    const ctxIssue = document.getElementById("issueTypeChart").getContext("2d");
    issueTypeChart = new Chart(ctxIssue, {
        type: 'doughnut',
        data: {
            labels: ['แผงชำรุด/ล้างแผง', 'อินเวอร์เตอร์/ตู้ไฟ', 'โครงสร้างและสาย'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: [
                    '#f59e0b',
                    '#ef4444',
                    '#3b82f6'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        font: { family: 'Sarabun', size: 11 },
                        padding: 15
                    }
                }
            },
            cutout: '70%'
        }
    });
}

function updateChartsData() {
    if (!maintenanceTypeChart || !issueTypeChart) return;

    let preventiveCount = 0;
    let correctiveCount = 0;

    reports.forEach(r => {
        if (r.maintenanceType === "Preventive Maintenance") preventiveCount++;
        else if (r.maintenanceType === "Corrective Maintenance") correctiveCount++;
    });

    maintenanceTypeChart.data.datasets[0].data = [preventiveCount, correctiveCount];
    maintenanceTypeChart.update();

    let panelIssues = 0;
    let electricalIssues = 0;
    let structureIssues = 0;

    reports.forEach(r => {
        if (r.checks) {
            Object.entries(r.checks).forEach(([key, val]) => {
                if (val === "Fix") {
                    const meta = checklistMetadata.find(m => m.key === key);
                    if (meta) {
                        if (meta.section.includes("1 PV Module")) {
                            panelIssues++;
                        } else if (
                            meta.section.includes("2 Array") ||
                            meta.section.includes("3 Inverter") ||
                            meta.section.includes("4 Solar") ||
                            meta.section.includes("7 Control")
                        ) {
                            electricalIssues++;
                        } else if (
                            meta.section.includes("5 Rapid") ||
                            meta.section.includes("6 Optimizer") ||
                            meta.section.includes("8 Weather") ||
                            meta.section.includes("9 Water")
                        ) {
                            structureIssues++;
                        }
                    }
                }
            });
        }
    });

    issueTypeChart.data.datasets[0].data = [panelIssues, electricalIssues, structureIssues];
    issueTypeChart.update();
}

function renderReportsTable() {
    const listContainer = document.getElementById("recent-reports-list");
    const sorted = [...reports].sort((a, b) => new Date(b.maintenanceDate) - new Date(a.maintenanceDate)).slice(0, 5);

    if (sorted.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">ไม่พบข้อมูลใบรายงานการตรวจเช็คระบบ</td></tr>`;
        return;
    }

    listContainer.innerHTML = "";
    sorted.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="font-weight:600; color:var(--primary-solar);">${r.id}</td>
            <td>
                <div style="font-weight:600;">${r.customerName}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary);">${r.location}</div>
            </td>
            <td>${formatDateThaiShort(r.maintenanceDate)}</td>
            <td><span class="badge ${getStatusBadgeClass(r.status)}">${translateStatus(r.status)}</span></td>
            <td>${r.technicianName}</td>
            <td>
                <div class="table-actions">
                    <button class="icon-btn primary" onclick="viewReportDetail('${r.id}')" title="ดูรายละเอียด/พิมพ์">
                        <i data-lucide="eye"></i>
                    </button>
                    <button class="icon-btn" onclick="editReport('${r.id}')" title="แก้ไข" style="color: var(--primary-solar); border-color: rgba(251, 191, 36, 0.3);">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="icon-btn danger" onclick="deleteReport('${r.id}')" title="ลบ">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        `;
        listContainer.appendChild(tr);
    });
    lucide.createIcons();
}

function renderHistoryTable(filteredList = null) {
    const listContainer = document.getElementById("history-reports-list");
    const sourceList = filteredList || reports;
    const sorted = [...sourceList].sort((a, b) => getSortTime(b) - getSortTime(a));

    if (sorted.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">ไม่พบข้อมูลประวัติรายงาน</td></tr>`;
        return;
    }

    listContainer.innerHTML = "";
    sorted.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="font-weight:600; color:var(--primary-solar);">${r.id}</td>
            <td>
                <div style="font-weight:600;">${r.customerName}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary);">${r.location}</div>
            </td>
            <td>${r.systemSize ? (String(r.systemSize).toLowerCase().includes('kwp') ? r.systemSize : `${r.systemSize} kWp`) : '-'}</td>
            <td>${formatDateThaiShort(r.maintenanceDate)}</td>
            <td><span class="badge ${getStatusBadgeClass(r.status)}">${translateStatus(r.status)}</span></td>
            <td>${r.technicianName}</td>
            <td>
                <div class="table-actions">
                    <button class="icon-btn primary" onclick="viewReportDetail('${r.id}')" title="ดูรายละเอียด/พิมพ์">
                        <i data-lucide="eye"></i>
                    </button>
                    <button class="icon-btn" onclick="editReport('${r.id}')" title="แก้ไข" style="color: var(--primary-solar); border-color: rgba(251, 191, 36, 0.3);">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="icon-btn danger" onclick="deleteReport('${r.id}')" title="ลบ">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        `;
        listContainer.appendChild(tr);
    });
    lucide.createIcons();
}



function getStatusBadgeClass(status) {
    switch (status) {
        case "Excellent": return "excellent";
        case "Normal": return "normal";
        case "Needs Maintenance": return "warning";
        case "Critical Error": return "danger";
        default: return "normal";
    }
}

function translateStatus(status) {
    switch (status) {
        case "Excellent": return "ทำงานยอดเยี่ยม";
        case "Normal": return "ปกติพร้อมใช้";
        case "Needs Maintenance": return "ควรซ่อมบำรุง/ล้างแผง";
        case "Critical Error": return "ระบบเกิดข้อผิดพลาด";
        default: return status;
    }
}

// Inspectors position/rank mapping for signing hierarchy
const roleRank = {
    "Service Engineer": 5,
    "Assist Service Engineer": 4,
    "Senior Foreman": 3,
    "Foreman": 2,
    "Monitoring": 1
};

function getInspectorRank(name) {
    const found = teamMembersList.find(m => m.name === name);
    if (found) {
        return roleRank[found.role] || 1;
    }
    return 1.5; // Custom/typed names get rank 1.5
}

function updateSelectedSigner() {
    const techGrid = document.getElementById("technicians-checkbox-grid");
    const techCustomInput = document.getElementById("technician-name-custom");
    const signerInfoDiv = document.getElementById("signer-auto-info");
    const signerDisplaySpan = document.getElementById("signer-name-display");

    if (!techGrid || !techCustomInput || !signerInfoDiv || !signerDisplaySpan) return "";

    const selectedNames = [];
    const checkedBoxes = techGrid.querySelectorAll("input[type='checkbox']:checked");
    checkedBoxes.forEach(cb => selectedNames.push(cb.value));

    const customVal = techCustomInput.value.trim();
    if (customVal) {
        customVal.split(",").forEach(n => {
            if (n.trim()) selectedNames.push(n.trim());
        });
    }

    if (selectedNames.length > 0) {
        let bestSigner = selectedNames[0];
        let maxRank = getInspectorRank(bestSigner);

        selectedNames.forEach(name => {
            const rank = getInspectorRank(name);
            if (rank > maxRank) {
                maxRank = rank;
                bestSigner = name;
            }
        });

        const teamMatch = teamMembersList.find(m => m.name === bestSigner);
        const roleSuffix = teamMatch ? ` (${teamMatch.role})` : " (ผู้ระบุเพิ่มเติม)";

        signerDisplaySpan.innerText = bestSigner + roleSuffix;
        signerInfoDiv.style.display = "block";
        return bestSigner;
    } else {
        signerInfoDiv.style.display = "none";
        signerDisplaySpan.innerText = "-";
        return "";
    }
}

function renderTechnicianCheckboxes() {
    const techGrid = document.getElementById("technicians-checkbox-grid");
    const techCustomInput = document.getElementById("technician-name-custom");
    if (!techGrid) return;

    techGrid.innerHTML = "";
    
    // Sort team members by role rank for professional layout
    const sortedMembers = [...teamMembersList].sort((a, b) => (roleRank[b.role] || 0) - (roleRank[a.role] || 0));

    sortedMembers.forEach(m => {
        const label = document.createElement("label");
        label.style.cssText = "display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-size: 0.85rem; color: var(--text-primary);";
        label.innerHTML = `
            <input type="checkbox" class="tech-checkbox-item" value="${m.name}" style="width: auto; cursor: pointer;">
            <span>${m.name} <small style="color: var(--text-muted); font-size: 0.72rem;">(${m.role})</small></span>
        `;
        techGrid.appendChild(label);
    });

    techGrid.querySelectorAll("input[type='checkbox']").forEach(cb => {
        cb.addEventListener("change", updateSelectedSigner);
    });

    if (techCustomInput) {
        techCustomInput.addEventListener("input", updateSelectedSigner);
    }
}

// Form Handlers
function initFormHandlers() {
    renderTechnicianCheckboxes();

    document.getElementById("btn-add-inverter").addEventListener("click", () => {
        addInverterInput();
    });

    const form = document.getElementById("report-form");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        showGlobalLoading("กำลังบันทึกข้อมูล...", "ระบบกำลังบันทึกประวัติการเข้าซ่อมบำรุงและอัปเดตระบบ...");
        animateGlobalProgress(80, 2000);

        const customerName = document.getElementById("customer-name").value;
        
        // Multi-select technicians collector
        const checkedBoxes = document.querySelectorAll("#technicians-checkbox-grid input[type='checkbox']:checked");
        const selectedTechs = Array.from(checkedBoxes).map(cb => cb.value);
        const techCustomVal = document.getElementById("technician-name-custom").value.trim();
        
        if (techCustomVal) {
            techCustomVal.split(",").forEach(n => {
                const cleanName = n.trim();
                if (cleanName && !selectedTechs.includes(cleanName)) {
                    selectedTechs.push(cleanName);
                }
            });
        }

        if (selectedTechs.length === 0) {
            alert("กรุณาเลือกหรือระบุชื่อผู้เข้าตรวจสอบอย่างน้อย 1 คน");
            return;
        }

        // Determine signer (highest rank)
        let primarySigner = selectedTechs[0];
        let maxRank = getInspectorRank(primarySigner);
        selectedTechs.forEach(name => {
            const rank = getInspectorRank(name);
            if (rank > maxRank) {
                maxRank = rank;
                primarySigner = name;
            }
        });

        const technicianName = selectedTechs.join(", ");
        const location = document.getElementById("installation-location").value;
        const systemSize = parseFloat(document.getElementById("system-size").value);
        const maintenanceDate = document.getElementById("maintenance-date").value;
        const maintenanceType = document.getElementById("maintenance-type").value;
        
        const inverterCards = document.querySelectorAll("#inverters-form-container .inverter-entry-card");
        const inverters = [];
        let totalAcPower = 0;
        
        if (maintenanceType !== "Corrective Maintenance") {
            let hasEmptyInverters = false;
            inverterCards.forEach(card => {
                const name = card.querySelector(".inv-name")?.value.trim() || "";
                const acPowerRaw = card.querySelector(".inv-ac-power")?.value.trim() || "";
                if (!name || !acPowerRaw) {
                    hasEmptyInverters = true;
                }
            });
            if (hasEmptyInverters) {
                alert("กรุณากรอกชื่อและกำลังผลิต AC ของอินเวอร์เตอร์ให้ครบถ้วน");
                return;
            }
        }

        inverterCards.forEach(card => {
            const name = card.querySelector(".inv-name")?.value.trim() || "";
            const model = card.querySelector(".inv-model")?.value.trim() || "";
            const acPowerRaw = card.querySelector(".inv-ac-power")?.value.trim() || "";
            const pvVoltage = card.querySelector(".inv-pv-voltage")?.value.trim() || "";
            const pvCurrent = card.querySelector(".inv-pv-current")?.value.trim() || "";
            const inverterTemp = card.querySelector(".inv-temp")?.value.trim() || "";
            const ajbTemp = card.querySelector(".inv-ajb-temp")?.value.trim() || "";
            
            const acPowerNum = parseFloat(acPowerRaw) || 0;
            totalAcPower += acPowerNum;

            inverters.push({
                name,
                model,
                acPower: acPowerRaw,
                pvVoltage,
                pvCurrent,
                inverterTemp,
                ajbTemp
            });
        });

        const checks = {};
        const checkRemarks = {};
        checklistMetadata.forEach(item => {
            const el = document.querySelector(`input[name="check-${item.key}"]:checked`);
            const status = el ? el.value : "Pass";
            checks[item.key] = status;
            
            if (status === "Fix") {
                const remarkEl = document.querySelector(`input[name="remark-${item.key}"]`);
                if (remarkEl && remarkEl.value.trim() !== "") {
                    checkRemarks[item.key] = remarkEl.value.trim();
                }
            }
        });

        let status = "Excellent";
        let hasFixes = false;
        if (checks) {
            Object.values(checks).forEach(val => {
                if (val === "Fix") hasFixes = true;
            });
        }
        if (hasFixes) {
            status = "Needs Maintenance";
        }
        const cmProblemDesc = document.getElementById("cm-problem-desc")?.value.trim() || "";
        const cmActionDesc = document.getElementById("cm-action-desc")?.value.trim() || "";
        const cmRepairStatus = document.getElementById("cm-repair-status")?.value || "Completed";
        const recommendations = document.getElementById("recommendations")?.value.trim() || "";

        if (maintenanceType === "Corrective Maintenance") {
            if (cmRepairStatus !== "Completed") {
                status = "Needs Maintenance";
            }
        }

        let reportId = editingReportId;
        if (!editingReportId) {
            // Generate ID: SR-YYYYMMDD-00X
            const dateStr = maintenanceDate.replace(/-/g, "");
            const todaysCount = reports.filter(r => r.maintenanceDate === maintenanceDate).length + 1;
            const paddedCount = String(todaysCount).padStart(3, "0");
            reportId = `SR-${dateStr}-${paddedCount}`;
        }

        let originalCreatedAt = new Date().toISOString();
        if (editingReportId) {
            const oldReport = reports.find(r => r.id === editingReportId);
            if (oldReport && oldReport.createdAt) {
                originalCreatedAt = oldReport.createdAt;
            }
        }

        const newReport = {
            id: reportId,
            createdAt: originalCreatedAt,
            customerName,
            technicianName,
            technicians: selectedTechs,
            primarySigner,
            location,
            systemSize,
            maintenanceDate,
            maintenanceType,
            acPower: totalAcPower,
            inverters,
            checks,
            checkRemarks,
            cmProblemDesc,
            cmActionDesc,
            cmRepairStatus,
            cmImagesBefore: [...currentCmImagesBefore],
            cmImagesAfter: [...currentCmImagesAfter],
            status,
            recommendations,
            imagesInverterRoom: [...currentImagesInverterRoom],
            imagesRooftop: [...currentImagesRooftop]
        };

        if (editingReportId) {
            const idx = reports.findIndex(r => r.id === editingReportId);
            if (idx !== -1) {
                reports[idx] = newReport;
            }
            editingReportId = null;
            document.getElementById("edit-report-banner").style.display = "none";
            document.getElementById("btn-save-report").querySelector("span").innerText = "บันทึกและสร้างรายงาน";
            document.getElementById("current-tab-title").innerText = "สร้างรายงานใหม่";
            document.getElementById("current-tab-subtitle").innerText = "กรอกข้อมูลรายละเอียดการเข้าตรวจเช็คหน้างาน";
        } else {
            reports.unshift(newReport);
        }

        saveReportsToLocalStorage();
        try {
            await syncReportToCloud(newReport);
            updateGlobalProgress(100);
            await new Promise(resolve => setTimeout(resolve, 400));
        } catch (err) {
            console.error("Cloud sync failed during save:", err);
        } finally {
            hideGlobalLoading();
        }

        form.reset();
        resetTechnicianFormState();
        document.getElementById("maintenance-date").value = new Date().toISOString().split('T')[0];
        currentImagesInverterRoom = [];
        currentImagesRooftop = [];
        currentCmImagesBefore = [];
        currentCmImagesAfter = [];
        document.getElementById("image-preview-container-inverter").innerHTML = "";
        document.getElementById("image-preview-container-rooftop").innerHTML = "";
        document.getElementById("cm-preview-before").innerHTML = "";
        document.getElementById("cm-preview-after").innerHTML = "";
        
        document.getElementById("inverters-form-container").innerHTML = "";
        addInverterInput("Inverter 1");
        renderFormChecklist();

        const modal = document.getElementById("save-success-modal");
        const modalTitle = document.getElementById("save-success-title");
        const modalMsg = document.getElementById("save-success-message");
        const modalCloseBtn = document.getElementById("btn-modal-close");

        if (modal) {
            if (modalTitle) modalTitle.innerText = "บันทึกข้อมูลเรียบร้อยแล้ว!";
            if (modalMsg) modalMsg.innerText = `ใบรายงานซ่อมบำรุงรหัส ${reportId} ถูกบันทึกและซิงค์ข้อมูลเรียบร้อยแล้ว`;
            modal.style.display = "flex";
            if (window.lucide) lucide.createIcons();

            modalCloseBtn.onclick = () => {
                modal.style.display = "none";
                viewReportDetail(reportId);
            };
        } else {
            alert(`บันทึกข้อมูลรายงานรหัส ${reportId} เรียบร้อยแล้ว!`);
            viewReportDetail(reportId);
        }
    });

    document.getElementById("btn-cancel-report").addEventListener("click", () => {
        if(confirm("คุณต้องการยกเลิกการกรอกรายงานใช่หรือไม่ ข้อมูลทั้งหมดจะสูญหาย")) {
            if (editingReportId) {
                cancelEditMode();
            } else {
                form.reset();
                resetTechnicianFormState();
                currentImagesInverterRoom = [];
                currentImagesRooftop = [];
                document.getElementById("image-preview-container-inverter").innerHTML = "";
                document.getElementById("image-preview-container-rooftop").innerHTML = "";
                
                document.getElementById("inverters-form-container").innerHTML = "";
                addInverterInput("Inverter 1");
                renderFormChecklist();
                
                window.switchTab("dashboard");
            }
        }
    });
}

function compressImage(file, maxWidth, maxHeight, quality, callback) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function (event) {
        const img = new Image();
        img.src = event.target.result;
        img.onload = function () {
            const canvas = document.createElement("canvas");
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
            callback(compressedBase64);
        };
    };
}

// Drag & Drop & Upload image
function initImageUpload() {
    setupUploadZone("inverter", "image-upload-zone-inverter", "image-input-inverter", "image-preview-container-inverter");
    setupUploadZone("rooftop", "image-upload-zone-rooftop", "image-input-rooftop", "image-preview-container-rooftop");
    setupUploadZone("cmBefore", "cm-upload-zone-before", "cm-image-input-before", "cm-preview-before");
    setupUploadZone("cmAfter", "cm-upload-zone-after", "cm-image-input-after", "cm-preview-after");
}

function setupUploadZone(type, zoneId, inputId, previewContainerId) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const previewContainer = document.getElementById(previewContainerId);
    
    if (!zone || !input || !previewContainer) return;

    zone.addEventListener("click", () => input.click());

    zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.style.borderColor = "var(--primary-solar)";
        zone.style.backgroundColor = "rgba(251, 191, 36, 0.05)";
    });

    zone.addEventListener("dragleave", () => {
        zone.style.borderColor = "var(--border-color)";
        zone.style.backgroundColor = "rgba(255,255,255,0.01)";
    });

    zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.style.borderColor = "var(--border-color)";
        zone.style.backgroundColor = "rgba(255,255,255,0.01)";
        
        if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });

    input.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            handleFiles(e.target.files);
        }
    });

    function handleFiles(files) {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith("image/")) return;

            // Compress to maximum 800px width/height and 0.55 JPEG quality for optimal cloud size
            compressImage(file, 800, 800, 0.55, (compressedBase64) => {
                if (type === "inverter") {
                    currentImagesInverterRoom.push(compressedBase64);
                } else if (type === "rooftop") {
                    currentImagesRooftop.push(compressedBase64);
                } else if (type === "cmBefore") {
                    currentCmImagesBefore.push(compressedBase64);
                } else if (type === "cmAfter") {
                    currentCmImagesAfter.push(compressedBase64);
                }
                renderImagesPreview(type);
            });
        });
    }
}

function renderImagesPreview(type) {
    let imagesList = [];
    let containerId = "";
    if (type === "inverter") {
        imagesList = currentImagesInverterRoom;
        containerId = "image-preview-container-inverter";
    } else if (type === "rooftop") {
        imagesList = currentImagesRooftop;
        containerId = "image-preview-container-rooftop";
    } else if (type === "cmBefore") {
        imagesList = currentCmImagesBefore;
        containerId = "cm-preview-before";
    } else if (type === "cmAfter") {
        imagesList = currentCmImagesAfter;
        containerId = "cm-preview-after";
    }

    const previewContainer = document.getElementById(containerId);
    if (!previewContainer) return;
    
    previewContainer.innerHTML = "";
    
    imagesList.forEach((img, idx) => {
        const wrapper = document.createElement("div");
        wrapper.className = "preview-wrapper";
        wrapper.setAttribute("data-index", idx);
        
        wrapper.innerHTML = `
            <img src="${img}" alt="preview">
            <button type="button" class="preview-remove" onclick="removeLoadedImage('${type}', ${idx})">&times;</button>
        `;
        previewContainer.appendChild(wrapper);
    });
}

function removeLoadedImage(type, index) {
    if (type === "inverter") {
        currentImagesInverterRoom.splice(index, 1);
    } else if (type === "rooftop") {
        currentImagesRooftop.splice(index, 1);
    } else if (type === "cmBefore") {
        currentCmImagesBefore.splice(index, 1);
    } else if (type === "cmAfter") {
        currentCmImagesAfter.splice(index, 1);
    }
    renderImagesPreview(type);
}

// Search and filtering
function initSearchAndFilter() {
    const searchInput = document.getElementById("history-search");
    const statusFilter = document.getElementById("history-status-filter");
    const clearBtn = document.getElementById("btn-clear-history");

    function runFilter() {
        const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const status = statusFilter ? statusFilter.value : "all";

        const filtered = reports.filter(r => {
            const matchesQuery = r.id.toLowerCase().includes(query) ||
                                 r.customerName.toLowerCase().includes(query) ||
                                 r.location.toLowerCase().includes(query);
            
            let matchesStatus = false;
            if (status === "all") {
                matchesStatus = true;
            } else if (status === "Fix") {
                matchesStatus = r.checks && Object.values(r.checks).some(val => val === "Fix");
            } else {
                matchesStatus = r.status === status;
            }

            return matchesQuery && matchesStatus;
        });

        renderHistoryTable(filtered);
    }

    if (searchInput) searchInput.addEventListener("input", runFilter);
    if (statusFilter) statusFilter.addEventListener("change", runFilter);

    // KPI Card Click Listeners
    const totalCard = document.getElementById("kpi-card-total-reports");
    if (totalCard) {
        totalCard.addEventListener("click", () => {
            switchTab("history");
            if (searchInput) searchInput.value = "";
            if (statusFilter) statusFilter.value = "all";
            runFilter();
        });
    }

    const issuesCard = document.getElementById("kpi-card-issues-found");
    if (issuesCard) {
        issuesCard.addEventListener("click", () => {
            switchTab("history");
            if (searchInput) searchInput.value = "";
            if (statusFilter) statusFilter.value = "Fix";
            runFilter();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            if (confirm("คำเตือน: คุณแน่ใจว่าต้องการลบประวัติงานรายงานทั้งหมดใช่หรือไม่?")) {
                reports = [];
                localStorage.removeItem("solar_reports");
                updateDashboard();
                renderHistoryTable();
                alert("ล้างประวัติเรียบร้อยแล้ว");
            }
        });
    }
}

function deleteReport(id) {
    if (confirm(`คุณแน่ใจว่าต้องการลบรายงานรหัส ${id} ใช่หรือไม่?`)) {
        reports = reports.filter(r => r.id !== id);
        saveReportsToLocalStorage();
        deleteReportFromCloud(id);
        updateDashboard();
        renderHistoryTable();
    }
}

// Detailed Report Viewer (Pre-print)
function viewReportDetail(id) {
    const report = reports.find(r => r.id === id);
    if (!report) return;

    window.switchTab("report-view");
    window.scrollTo(0, 0);

    document.getElementById("print-report-id").innerText = report.id;
    
    const dateFormatted = formatDateThaiFull(report.maintenanceDate);
    document.getElementById("print-created-date").innerText = dateFormatted;
    document.getElementById("print-date").innerText = dateFormatted;

    document.getElementById("print-customer-name").innerText = report.customerName;
    document.getElementById("print-location").innerText = report.location;
    document.getElementById("print-type").innerText = translateMaintenanceType(report.maintenanceType);
    const systemSizeNum = parseFloat(report.systemSize);
    document.getElementById("print-system-size").innerText = !isNaN(systemSizeNum) ? systemSizeNum.toFixed(1) : "-";
    document.getElementById("print-technician").innerText = report.technicianName;

    // Render Inverters Table
    const invertersBody = document.getElementById("print-inverters-body");
    invertersBody.innerHTML = "";
    
    function formatUnitDisplay(val, defaultUnit) {
        if (val === undefined || val === null || String(val).trim() === "" || String(val).trim() === "-") {
            return "-";
        }
        const str = String(val).trim();
        if (defaultUnit && !str.toLowerCase().includes(defaultUnit.toLowerCase())) {
            return `${str} ${defaultUnit}`;
        }
        return str;
    }

    if (report.inverters && report.inverters.length > 0) {
        report.inverters.forEach(inv => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="font-weight:600;">
                    ${inv.name}
                    ${inv.model ? `<div style="font-size:0.7rem; color:#64748b; font-weight:normal; margin-top:2px;">รุ่น: ${inv.model}</div>` : ""}
                </td>
                <td>${formatUnitDisplay(inv.pvVoltage, "")}</td>
                <td>${formatUnitDisplay(inv.pvCurrent, "")}</td>
                <td>${formatUnitDisplay(inv.acPower, "kW")}</td>
                <td>${formatUnitDisplay(inv.inverterTemp, "")}</td>
                <td>${formatUnitDisplay(inv.ajbTemp, "")}</td>
            `;
            invertersBody.appendChild(tr);
        });
    } else {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="font-weight:600;">Inverter 1</td>
            <td>-</td>
            <td>-</td>
            <td>${formatUnitDisplay(report.acPower, "kW")}</td>
            <td>-</td>
            <td>-</td>
        `;
        invertersBody.appendChild(tr);
    }

    // PM vs CM Section Display Toggle in Print Document
    const isCmReport = report.maintenanceType === "Corrective Maintenance";
    const pmPrintSec = document.getElementById("print-pm-checklist-section");
    const cmPrintSec = document.getElementById("print-cm-repair-section");
    const printInvSec = document.getElementById("print-inverter-parameters-section");
    const printGeneralPhotosSec = document.getElementById("print-photos-section");
    const manualBreak = document.getElementById("print-page-break-before-summary");

    if (manualBreak) {
        manualBreak.style.display = "";
    }

    if (isCmReport) {
        if (pmPrintSec) pmPrintSec.style.display = "none";
        if (cmPrintSec) cmPrintSec.style.display = "block";
        if (printInvSec) printInvSec.style.display = "none";
        if (printGeneralPhotosSec) printGeneralPhotosSec.style.display = "none";

        const problemEl = document.getElementById("print-cm-problem-text");
        const actionEl = document.getElementById("print-cm-action-text");
        const badgeEl = document.getElementById("print-cm-status-badge");

        if (problemEl) problemEl.innerText = report.cmProblemDesc || (report.checkRemarks?.panelsDirt ? `พบปัญหา: ${report.checkRemarks.panelsDirt}` : "พบปัญหาอินเวอร์เตอร์/ระบบส่งจ่ายไฟฟ้าแจ้งเตือนขัดข้อง");
        if (actionEl) actionEl.innerText = report.cmActionDesc || report.recommendations || "ได้เข้าแก้ไขปรับปรุงขั้วต่อสายไฟและทดสอบการทำงานของระบบกลับคืนสภาพปกติ";
        
        if (badgeEl) {
            const st = report.cmRepairStatus || (report.status === "Needs Maintenance" ? "In Progress" : "Completed");
            if (st === "Completed") {
                badgeEl.style.cssText = "padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; background: #dcfce7; color: #15803d; border: 1px solid #86efac;";
                badgeEl.innerText = "🟢 แก้ไขเสร็จสิ้นเรียบร้อย (Completed)";
            } else if (st === "In Progress") {
                badgeEl.style.cssText = "padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; background: #fef3c7; color: #b45309; border: 1px solid #fcd34d;";
                badgeEl.innerText = "🟡 อยู่ระหว่างดำเนินการ (In Progress)";
            } else {
                badgeEl.style.cssText = "padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;";
                badgeEl.innerText = "🔴 รออะไหล่/อุปกรณ์สั่งซื้อ (Pending Parts)";
            }
        }

        // Before & After Photos
        const beforeContainer = document.getElementById("print-cm-photos-before-container");
        const afterContainer = document.getElementById("print-cm-photos-after-container");

        if (beforeContainer) {
            beforeContainer.innerHTML = "";
            const imgsBefore = report.cmImagesBefore || [];
            if (imgsBefore.length === 0) {
                beforeContainer.innerHTML = `<div style="font-size:0.75rem; color:#94a3b8; font-style:italic;">ไม่มีรูปถ่ายก่อนแก้ไข</div>`;
            } else {
                imgsBefore.forEach(img => {
                    beforeContainer.innerHTML += `<div class="print-photo-item"><img src="${img}" alt="Before"></div>`;
                });
            }
        }

        if (afterContainer) {
            afterContainer.innerHTML = "";
            const imgsAfter = report.cmImagesAfter || [];
            if (imgsAfter.length === 0) {
                afterContainer.innerHTML = `<div style="font-size:0.75rem; color:#94a3b8; font-style:italic;">ไม่มีรูปถ่ายหลังแก้ไข</div>`;
            } else {
                imgsAfter.forEach(img => {
                    afterContainer.innerHTML += `<div class="print-photo-item"><img src="${img}" alt="After"></div>`;
                });
            }
        }
    } else {
        if (pmPrintSec) pmPrintSec.style.display = "block";
        if (cmPrintSec) cmPrintSec.style.display = "none";
        if (printInvSec) printInvSec.style.display = "block";
        if (printGeneralPhotosSec) printGeneralPhotosSec.style.display = "block";

        // Render PM Checklist Tables dynamically (one table per category to prevent orphaned subheaders)
        const container = document.getElementById("pm-checklist-tables-container");
        if (container) {
            container.innerHTML = "";
            
            const printSections = {};
            checklistMetadata.forEach(item => {
                if (!printSections[item.section]) printSections[item.section] = [];
                printSections[item.section].push(item);
            });

            for (const [sectionName, items] of Object.entries(printSections)) {
                // Create category wrapper to prevent page breaks inside individual categories
                const wrapperDiv = document.createElement("div");
                wrapperDiv.className = "print-checklist-category-wrapper";
                container.appendChild(wrapperDiv);

                // 1. Create category header block
                const headerDiv = document.createElement("div");
                headerDiv.className = "checklist-section-title";
                headerDiv.innerText = sectionName;
                wrapperDiv.appendChild(headerDiv);

                // 2. Create category table
                const table = document.createElement("table");
                table.className = "checklist-print-table";
                table.style.marginBottom = "20px";
                table.style.marginTop = "0px";
                
                table.innerHTML = `
                    <thead>
                        <tr>
                            <th style="padding:6px 12px; font-size:0.8rem; border:1px solid #cbd5e1; text-align:left; background-color:#f8fafc; color:#475569; width:40%;">หัวข้อที่ทำการตรวจสอบ</th>
                            <th style="padding:6px 12px; font-size:0.8rem; border:1px solid #cbd5e1; text-align:center; background-color:#f8fafc; color:#475569; width:15%;">สถานะการประเมิน</th>
                            <th style="padding:6px 12px; font-size:0.8rem; border:1px solid #cbd5e1; text-align:left; background-color:#f8fafc; color:#475569; width:45%;">รายละเอียดแนวทางตรวจเช็ค</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                `;
                
                const tbody = table.querySelector("tbody");
                wrapperDiv.appendChild(table);

                const allNa = items.every(item => (report.checks?.[item.key] || "Pass") === "N/A");

                if (allNa) {
                    const summaryTr = document.createElement("tr");
                    summaryTr.innerHTML = `
                        <td style="padding:8px 12px; font-weight:500; font-size:0.8rem; border:1px solid #cbd5e1; color:#64748b;">
                            สถานะการติดตั้งอุปกรณ์${sectionName}
                        </td>
                        <td style="padding:8px 12px; text-align:center; width:120px; border:1px solid #cbd5e1;">
                            <span class="badge-print na" style="background-color: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">ไม่มีการติดตั้ง (N/A)</span>
                        </td>
                        <td style="padding:8px 12px; font-size:0.75rem; border:1px solid #cbd5e1; color:#94a3b8; font-style: italic;">
                            ไม่มีการติดตั้งอุปกรณ์หัวข้อนี้หน้างาน
                        </td>
                    `;
                    tbody.appendChild(summaryTr);
                } else {
                    items.forEach(item => {
                        const statusVal = report.checks?.[item.key] || "Pass";
                        const tr = document.createElement("tr");
                        
                        let statusBadge = "";
                        if (statusVal === "Pass") {
                            statusBadge = `<span class="badge-print pass">ผ่าน (Pass)</span>`;
                        } else if (statusVal === "Fix") {
                            statusBadge = `<span class="badge-print fix" style="background-color: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">ต้องแก้ไข (Fix)</span>`;
                        } else {
                            statusBadge = `<span class="badge-print na" style="background-color: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">ไม่มีติดตั้ง (N/A)</span>`;
                        }
                        
                        const remarkVal = report.checkRemarks?.[item.key] || "";
                        let cellContent = "";
                        if (statusVal === "Fix") {
                            cellContent = remarkVal 
                                ? `<strong style="color: var(--status-danger); font-size:0.78rem;">[ต้องแก้ไข]: ${remarkVal}</strong>` 
                                : `<span style="color:#64748b;">${item.desc}</span>`;
                        } else if (statusVal === "N/A") {
                            cellContent = `<span style="color:#94a3b8; font-style: italic;">ไม่มีการติดตั้งอุปกรณ์หัวข้อนี้หน้างาน</span>`;
                        } else {
                            cellContent = `<span style="color:#64748b;">${item.desc}</span>`;
                        }
                            
                        tr.innerHTML = `
                            <td style="padding:8px 12px; font-weight:500; font-size:0.8rem; border:1px solid #cbd5e1; width:40%;">${item.label}</td>
                            <td style="padding:8px 12px; text-align:center; border:1px solid #cbd5e1; width:15%;">${statusBadge}</td>
                            <td style="padding:8px 12px; font-size:0.75rem; border:1px solid #cbd5e1; width:45%;">${cellContent}</td>
                        `;
                        
                        tbody.appendChild(tr);
                    });
                }
            }
        }
    }

    // Inverter summaries in Section 3
    const printCmTitle = document.getElementById("print-cm-title");
    if (printCmTitle) {
        printCmTitle.innerText = isCmReport ? "1. สรุปผลการซ่อมบำรุงแก้ไข (Corrective Maintenance Report)" : "2. สรุปผลการซ่อมบำรุงแก้ไข (Corrective Maintenance Report)";
    }

    const printSummaryTitle = document.getElementById("print-summary-title");
    if (printSummaryTitle) {
        printSummaryTitle.innerText = isCmReport ? "2. สรุปการแก้ไขบำรุงรักษาและข้อเสนอแนะ" : "3. สรุปค่าตรวจวัดอินเวอร์เตอร์และข้อเสนอแนะ";
    }

    const printInvSummary = document.getElementById("print-inverters-summary-container");
    if (printInvSummary) {
        if (isCmReport) {
            printInvSummary.style.display = "none";
        } else {
            printInvSummary.style.display = "grid";
            printInvSummary.innerHTML = "";
            if (report.inverters && report.inverters.length > 0) {
                report.inverters.forEach(inv => {
                    const card = document.createElement("div");
                    card.className = "print-summary-inverter-card";
                    card.style.border = "1px solid #cbd5e1";
                    card.style.borderRadius = "6px";
                    card.style.padding = "10px";
                    card.style.backgroundColor = "#f8fafc";
                    card.innerHTML = `
                        <h4 style="font-size: 0.85rem; font-weight: 700; color: #0f172a; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span>${inv.name} ${inv.model ? `<span style="font-weight: normal; font-size: 0.7rem; color: #64748b;">(${inv.model})</span>` : ""}</span>
                            <span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background-color: var(--primary-solar-glow); color: var(--primary-solar); font-weight: 600;">O&M Checked</span>
                        </h4>
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; font-size: 0.78rem; color: #475569;">
                            <div><strong>กำลัง AC:</strong> ${formatUnitDisplay(inv.acPower, "kW")}</div>
                            <div><strong>แรงดัน PV:</strong> ${formatUnitDisplay(inv.pvVoltage, "Vdc")}</div>
                            <div><strong>กระแส PV:</strong> ${formatUnitDisplay(inv.pvCurrent, "Idc")}</div>
                            <div><strong>อุณหภูมิ Inverter:</strong> ${formatUnitDisplay(inv.inverterTemp, "°C")}</div>
                            <div style="grid-column: span 2;"><strong>อุณหภูมิภายในตู้ AJB:</strong> ${formatUnitDisplay(inv.ajbTemp, "°C")}</div>
                        </div>
                    `;
                    printInvSummary.appendChild(card);
                });
            } else {
                printInvSummary.innerHTML = `<div style="grid-column: span 2; text-align: center; color: #64748b; font-size: 0.8rem; padding: 10px;">ไม่มีข้อมูลค่าตรวจวัดอินเวอร์เตอร์</div>`;
            }
        }
    }
    
    document.getElementById("print-recommendation-text").innerText = report.recommendations || "ระบบอยู่ในเกณฑ์สมบูรณ์ ไม่มีความเสียหายจำเพาะเจาะจงที่จำเป็นต้องซ่อมบำรุงในเวลานี้";

    const techSignName = report.primarySigner || (report.technicianName && typeof report.technicianName === 'string' ? report.technicianName.split(",")[0].trim() : "");
    document.getElementById("print-sign-tech").innerText = techSignName;

    const custSignName = report.customerName && typeof report.customerName === 'string' ? report.customerName.split(" (")[0] : "";
    document.getElementById("print-sign-cust").innerText = custSignName;

    // Photos Gallery
    const photoSection = document.getElementById("print-photos-section");
    const invPhotoSection = document.getElementById("print-photos-inverter-section");
    const invPhotoContainer = document.getElementById("print-photo-gallery-container-inverter");
    const roofPhotoSection = document.getElementById("print-photos-rooftop-section");
    const roofPhotoContainer = document.getElementById("print-photo-gallery-container-rooftop");
    
    const hasInverterPhotos = report.imagesInverterRoom && report.imagesInverterRoom.length > 0;
    const hasRooftopPhotos = report.imagesRooftop && report.imagesRooftop.length > 0;
    
    if (hasInverterPhotos || hasRooftopPhotos) {
        photoSection.style.display = "block";
        
        if (hasInverterPhotos) {
            invPhotoSection.style.display = "block";
            invPhotoContainer.innerHTML = "";
            report.imagesInverterRoom.forEach(img => {
                const item = document.createElement("div");
                item.className = "print-photo-item";
                item.innerHTML = `<img src="${img}" alt="รูปภาพในห้องอินเวอร์เตอร์">`;
                invPhotoContainer.appendChild(item);
            });
        } else {
            invPhotoSection.style.display = "none";
        }
        
        if (hasRooftopPhotos) {
            roofPhotoSection.style.display = "block";
            roofPhotoContainer.innerHTML = "";
            report.imagesRooftop.forEach(img => {
                const item = document.createElement("div");
                item.className = "print-photo-item";
                item.innerHTML = `<img src="${img}" alt="รูปภาพบนหลังคา">`;
                roofPhotoContainer.appendChild(item);
            });
        } else {
            roofPhotoSection.style.display = "none";
        }
    } else {
        photoSection.style.display = "none";
    }

    // Bind Print Button
    const printBtn = document.getElementById("btn-trigger-print");
    const newPrintBtn = printBtn.cloneNode(true);
    printBtn.parentNode.replaceChild(newPrintBtn, printBtn);
    newPrintBtn.addEventListener("click", () => {
        window.scrollTo(0, 0);
        window.print();
    });

    // Bind Google Drive Button
    const driveBtn = document.getElementById("btn-trigger-drive");
    if (driveBtn) {
        const newDriveBtn = driveBtn.cloneNode(true);
        driveBtn.parentNode.replaceChild(newDriveBtn, driveBtn);
        newDriveBtn.addEventListener("click", () => {
            uploadReportToGoogleDrive(report);
        });
    }
}

function translateMaintenanceType(type) {
    switch (type) {
        case "Routine Check": return "ตรวจเช็คระบบตามระยะปกติ";
        case "Corrective Maintenance": return "ซ่อมบำรุงแก้ไข (Corrective)";
        case "Preventive Maintenance": return "บำรุงรักษาเชิงป้องกัน (Preventive)";
        default: return type;
    }
}

// Inverters management
function addInverterInput(name = "", values = {}) {
    const container = document.getElementById("inverters-form-container");
    const index = container.children.length;
    const invName = name || `Inverter ${index + 1}`;
    
    const card = document.createElement("div");
    card.className = "inverter-entry-card";
    card.innerHTML = `
        <div class="inverter-entry-header">
            <h4>${invName}</h4>
            <button type="button" class="btn-remove-inverter no-print" title="ลบอินเวอร์เตอร์นี้">
                <i data-lucide="trash-2"></i>
            </button>
        </div>
        <div class="form-row">
            <div class="form-group col-4">
                <label>ชื่อ/หมายเลขอินเวอร์เตอร์ <span class="required">*</span></label>
                <input type="text" class="inv-name" value="${invName}" placeholder="เช่น Inverter 1">
            </div>
            <div class="form-group col-4">
                <label>ยี่ห้อ/รุ่นอินเวอร์เตอร์</label>
                <input type="text" class="inv-model" value="${values.model || ''}" placeholder="เช่น Huawei SUN2000-50KTL">
            </div>
            <div class="form-group col-4">
                <label>กำลังผลิต AC (kW) <span class="required">*</span></label>
                <input type="text" class="inv-ac-power" value="${values.acPower || ''}" placeholder="เช่น 125 kW">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group col-3">
                <label>แรงดัน PV เฉลี่ย (Vdc)</label>
                <input type="text" class="inv-pv-voltage" value="${values.pvVoltage || ''}" placeholder="เช่น 808 หรือ 808/815">
            </div>
            <div class="form-group col-3">
                <label>กระแส PV เฉลี่ย (Idc)</label>
                <input type="text" class="inv-pv-current" value="${values.pvCurrent || ''}" placeholder="เช่น 4.5 หรือ 4.5-5.0">
            </div>
            <div class="form-group col-3">
                <label>อุณหภูมิอินเวอร์เตอร์ (°C)</label>
                <input type="text" class="inv-temp" value="${values.inverterTemp || ''}" placeholder="เช่น 45">
            </div>
            <div class="form-group col-3">
                <label>อุณหภูมิอุปกรณ์ภายในตู้ AJB (°C)</label>
                <input type="text" class="inv-ajb-temp" value="${values.ajbTemp || ''}" placeholder="เช่น 38">
            </div>
        </div>
    `;
    
    const deleteBtn = card.querySelector(".btn-remove-inverter");
    deleteBtn.addEventListener("click", () => {
        if (container.children.length <= 1) {
            alert("ต้องมีข้อมูลอินเวอร์เตอร์อย่างน้อย 1 รายการ!");
            return;
        }
        card.remove();
        renameInverters();
    });

    container.appendChild(card);
    lucide.createIcons();
}

function renameInverters() {
    const cards = document.querySelectorAll("#inverters-form-container .inverter-entry-card");
    cards.forEach((card, idx) => {
        const title = card.querySelector(".inverter-entry-header h4");
        const nameInput = card.querySelector(".inv-name");
        
        const currentName = nameInput.value;
        const defaultNamePattern = /^Inverter \d+$/;
        
        if (defaultNamePattern.test(currentName) || currentName === "") {
            nameInput.value = `Inverter ${idx + 1}`;
            title.innerText = `Inverter ${idx + 1}`;
        } else {
            title.innerText = currentName;
        }
    });
}

// Render dynamic checklist
function renderFormChecklist() {
    const container = document.getElementById("checklist-form-container");
    if (!container) return;
    
    container.innerHTML = "";
    
    const sections = {};
    checklistMetadata.forEach(item => {
        if (!sections[item.section]) {
            sections[item.section] = [];
        }
        sections[item.section].push(item);
    });
    
    for (const [sectionName, items] of Object.entries(sections)) {
        const secDiv = document.createElement("div");
        secDiv.className = "checklist-section";
        secDiv.innerHTML = `<h4>${sectionName}</h4>`;
        
        let toggleHtml = "";
        let isOptional = false;
        let sectionId = "";
        if (sectionName.includes("2 Array") || sectionName.includes("5 Rapid") || sectionName.includes("6 Optimizer") || sectionName.includes("7 Control") || sectionName.includes("8 Weather") || sectionName.includes("9 Water")) {
            isOptional = true;
            sectionId = sectionName.replace(/[^a-zA-Z0-9]/g, "");
            toggleHtml = `
                <div class="section-install-toggle" style="display: flex; gap: 15px; margin-bottom: 12px; align-items: center; background: var(--bg-secondary); padding: 8px 12px; border-radius: var(--border-radius-sm); border: 1px dashed var(--border-color);">
                    <span style="font-weight: 600; font-size: 0.8rem; color: var(--text-primary);">การติดตั้งอุปกรณ์:</span>
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; cursor: pointer; color: var(--text-primary); margin: 0;">
                        <input type="radio" name="install-toggle-${sectionId}" value="installed" checked style="accent-color: var(--primary-solar);">
                        มีการติดตั้งอุปกรณ์
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; cursor: pointer; color: var(--text-secondary); margin: 0;">
                        <input type="radio" name="install-toggle-${sectionId}" value="not-installed" style="accent-color: var(--primary-solar);">
                        ไม่มีการติดตั้งอุปกรณ์
                    </label>
                </div>
            `;
            secDiv.innerHTML += toggleHtml;
        }

        const itemsWrapper = document.createElement("div");
        itemsWrapper.className = "checklist-items-wrapper";
        if (isOptional) {
            itemsWrapper.id = `wrapper-${sectionId}`;
        }
        
        items.forEach(item => {
            const itemDiv = document.createElement("div");
            itemDiv.className = "checklist-item";
            itemDiv.style.flexDirection = "column";
            itemDiv.style.alignItems = "stretch";
            
            const badgeClass = item.type === "warning" ? "warning" : "danger";
            
            const isMandatory = sectionName.includes("1 PV") ||
                                sectionName.includes("3 Inverter") ||
                                sectionName.includes("4 Solar");
                                
            const naRadioHtml = isMandatory ? "" : `
                        <label class="switch-btn" style="border-color: #cbd5e1; color: #475569;">
                            <input type="radio" name="check-${item.key}" value="N/A">
                            <span style="font-size: 0.72rem;">ไม่มีติดตั้ง</span>
                        </label>
            `;
            
            itemDiv.innerHTML = `
                <div class="checklist-main-row" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div class="check-title">
                        <span class="title">${item.label}</span>
                        <span class="desc">${item.desc}</span>
                    </div>
                    <div class="check-actions" style="display: flex; gap: 4px;">
                        <label class="switch-btn">
                            <input type="radio" name="check-${item.key}" value="Pass" checked>
                            <span>ปกติ</span>
                        </label>
                        <label class="switch-btn ${badgeClass}">
                            <input type="radio" name="check-${item.key}" value="Fix">
                            <span>ต้องแก้ไข</span>
                        </label>
                        ${naRadioHtml}
                    </div>
                </div>
                <div class="check-remark-container" style="display: none; width: 100%; margin-top: 8px; animation: fadeIn 0.3s ease;">
                    <input type="text" class="check-remark-input" name="remark-${item.key}" placeholder="ระบุรายละเอียดปัญหารายการนี้ (เช่น สายไฟเปื่อยชำรุด, พัดลมไม่หมุน)...">
                </div>
            `;
            
            const radios = itemDiv.querySelectorAll(`input[name="check-${item.key}"]`);
            const remarkContainer = itemDiv.querySelector(".check-remark-container");
            const remarkInput = itemDiv.querySelector(".check-remark-input");
            
            radios.forEach(radio => {
                radio.addEventListener("change", () => {
                    if (radio.value === "Fix") {
                        remarkContainer.style.display = "block";
                        remarkInput.focus();
                    } else {
                        remarkContainer.style.display = "none";
                        remarkInput.value = "";
                    }
                });
            });
            
            itemsWrapper.appendChild(itemDiv);
        });
        
        secDiv.appendChild(itemsWrapper);
        container.appendChild(secDiv);

        if (isOptional) {
            const toggleRadios = secDiv.querySelectorAll(`input[name="install-toggle-${sectionId}"]`);
            toggleRadios.forEach(tr => {
                tr.addEventListener("change", () => {
                    if (tr.value === "not-installed") {
                        itemsWrapper.style.display = "none";
                        items.forEach(item => {
                            const naRadio = secDiv.querySelector(`input[name="check-${item.key}"][value="N/A"]`);
                            if (naRadio) {
                                naRadio.checked = true;
                                naRadio.dispatchEvent(new Event('change'));
                            }
                        });
                    } else {
                        itemsWrapper.style.display = "block";
                        items.forEach(item => {
                            const passRadio = secDiv.querySelector(`input[name="check-${item.key}"][value="Pass"]`);
                            if (passRadio) {
                                passRadio.checked = true;
                                passRadio.dispatchEvent(new Event('change'));
                            }
                        });
                    }
                });
            });
        }
    }
}

// Thai Date formatting helper
function formatDateThaiFull(dateStr) {
    if (!dateStr) return '';
    const months = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];
    const d = new Date(dateStr);
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function formatDateThaiShort(dateStr) {
    if (!dateStr) return '';
    const monthsShort = [
        "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
        "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
    ];
    const d = new Date(dateStr);
    return `${d.getDate()} ${monthsShort[d.getMonth()]} ${d.getFullYear() + 543}`;
}

// Edit Report Helper
function editReport(id) {
    const report = reports.find(r => r.id === id);
    if (!report) return;
    
    editingReportId = id;
    
    // Update UI to edit mode
    document.getElementById("edit-report-banner").style.display = "flex";
    document.getElementById("edit-report-id-display").innerText = report.id;
    document.getElementById("btn-save-report").querySelector("span").innerText = "บันทึกการแก้ไข";
    document.getElementById("current-tab-title").innerText = "แก้ไขรายงานซ่อมบำรุง";
    document.getElementById("current-tab-subtitle").innerText = `แก้ไขรายละเอียดรายงานรหัส ${report.id}`;
    
    // Pre-fill fields
    document.getElementById("customer-name").value = report.customerName;
    
    // Prefill multi-select checkboxes for technicians
    const techGrid = document.getElementById("technicians-checkbox-grid");
    const techCustom = document.getElementById("technician-name-custom");
    if (techGrid && techCustom) {
        // Reset all checkboxes first
        const checkboxes = techGrid.querySelectorAll("input[type='checkbox']");
        checkboxes.forEach(cb => { cb.checked = false; });
        techCustom.value = "";

        const existingNames = report.technicians || (report.technicianName ? report.technicianName.split(",").map(n => n.trim()) : []);
        const customNames = [];

        existingNames.forEach(name => {
            if (!name) return;
            const cb = Array.from(checkboxes).find(c => c.value === name);
            if (cb) {
                cb.checked = true;
            } else {
                customNames.push(name);
            }
        });

        if (customNames.length > 0) {
            techCustom.value = customNames.join(", ");
        }

        // Update display details
        updateSelectedSigner();
    }
    
    document.getElementById("installation-location").value = report.location;
    document.getElementById("system-size").value = report.systemSize;
    document.getElementById("maintenance-date").value = report.maintenanceDate;
    document.getElementById("maintenance-type").value = report.maintenanceType;
    
    // Inverters
    const container = document.getElementById("inverters-form-container");
    container.innerHTML = "";
    if (report.inverters && report.inverters.length > 0) {
        report.inverters.forEach(inv => {
            addInverterInput(inv.name, inv);
        });
    } else {
        addInverterInput("Inverter 1", { acPower: report.acPower });
    }
    
    // Checklist
    renderFormChecklist();
    checklistMetadata.forEach(item => {
        const statusVal = report.checks?.[item.key] || "Pass";
        const radio = document.querySelector(`input[name="check-${item.key}"][value="${statusVal}"]`);
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
        }
        
        if (statusVal === "Fix") {
            const remarkEl = document.querySelector(`input[name="remark-${item.key}"]`);
            if (remarkEl) {
                remarkEl.value = report.checkRemarks?.[item.key] || "";
            }
        }
    });

    const sections = {};
    checklistMetadata.forEach(item => {
        if (!sections[item.section]) {
            sections[item.section] = [];
        }
        sections[item.section].push(item);
    });

    for (const [sectionName, items] of Object.entries(sections)) {
        if (sectionName.includes("2 Array") || sectionName.includes("5 Rapid") || sectionName.includes("6 Optimizer") || sectionName.includes("7 Control") || sectionName.includes("8 Weather") || sectionName.includes("9 Water")) {
            const sectionId = sectionName.replace(/[^a-zA-Z0-9]/g, "");
            const allNa = items.every(item => (report.checks?.[item.key] || "Pass") === "N/A");
            
            const notInstalledRadio = document.querySelector(`input[name="install-toggle-${sectionId}"][value="not-installed"]`);
            const installedRadio = document.querySelector(`input[name="install-toggle-${sectionId}"][value="installed"]`);
            const wrapper = document.getElementById(`wrapper-${sectionId}`);
            
            if (allNa && notInstalledRadio && wrapper) {
                notInstalledRadio.checked = true;
                wrapper.style.display = "none";
            } else if (installedRadio && wrapper) {
                installedRadio.checked = true;
                wrapper.style.display = "block";
            }
        }
    }
    
    // Recommendations
    document.getElementById("recommendations").value = report.recommendations || "";
    
    // Prefill CM fields
    document.getElementById("cm-problem-desc").value = report.cmProblemDesc || "";
    document.getElementById("cm-action-desc").value = report.cmActionDesc || "";
    document.getElementById("cm-repair-status").value = report.cmRepairStatus || "Completed";
    
    currentCmImagesBefore = [...(report.cmImagesBefore || [])];
    currentCmImagesAfter = [...(report.cmImagesAfter || [])];
    
    renderImagesPreview("cmBefore");
    renderImagesPreview("cmAfter");
    
    // Trigger change event to toggle proper forms UI (PM vs CM)
    document.getElementById("maintenance-type").dispatchEvent(new Event('change'));

    // Images
    currentImagesInverterRoom = [...(report.imagesInverterRoom || [])];
    currentImagesRooftop = [...(report.imagesRooftop || [])];
    
    renderImagesPreview("inverter");
    renderImagesPreview("rooftop");
    
    // Switch to form tab
    window.switchTab("new-report");
}

function cancelEditMode() {
    editingReportId = null;
    document.getElementById("edit-report-banner").style.display = "none";
    document.getElementById("btn-save-report").querySelector("span").innerText = "บันทึกและสร้างรายงาน";
    document.getElementById("current-tab-title").innerText = "สร้างรายงานใหม่";
    document.getElementById("current-tab-subtitle").innerText = "กรอกข้อมูลรายละเอียดการเข้าตรวจเช็คหน้างาน";
    
    // Reset form
    document.getElementById("report-form").reset();
    resetTechnicianFormState();
    document.getElementById("maintenance-date").value = new Date().toISOString().split('T')[0];
    currentImagesInverterRoom = [];
    currentImagesRooftop = [];
    currentCmImagesBefore = [];
    currentCmImagesAfter = [];
    document.getElementById("image-preview-container-inverter").innerHTML = "";
    document.getElementById("image-preview-container-rooftop").innerHTML = "";
    document.getElementById("cm-preview-before").innerHTML = "";
    document.getElementById("cm-preview-after").innerHTML = "";
    
    document.getElementById("inverters-form-container").innerHTML = "";
    addInverterInput("Inverter 1");
    renderFormChecklist();
    
    window.switchTab("dashboard");
}

function resetTechnicianFormState() {
    const techGrid = document.getElementById("technicians-checkbox-grid");
    const techCustomInput = document.getElementById("technician-name-custom");
    if (techGrid) {
        techGrid.querySelectorAll("input[type='checkbox']").forEach(cb => { cb.checked = false; });
    }
    if (techCustomInput) {
        techCustomInput.value = "";
    }
    updateSelectedSigner();
}

// Global exports
window.deleteReport = deleteReport;
window.viewReportDetail = viewReportDetail;
window.removeLoadedImage = removeLoadedImage;
window.addInverterInput = addInverterInput;
window.renameInverters = renameInverters;
window.renderFormChecklist = renderFormChecklist;
window.editReport = editReport;
window.cancelEditMode = cancelEditMode;
window.resetTechnicianFormState = resetTechnicianFormState;

// Inspectors Team Directory Data & Functions
const defaultTeamMembersList = [
    { name: "ปิติชัย ศรีสุนนท์", role: "Service Engineer", phone: "095-6632197", tel: "0956632197", badgeColor: "#fbbf24", badgeBg: "rgba(251, 191, 36, 0.15)" },
    { name: "ภูมิระพี หนาชุย", role: "Assist Service Engineer", phone: "098-6352564", tel: "0986352564", badgeColor: "#fbbf24", badgeBg: "rgba(251, 191, 36, 0.15)" },
    { name: "ชุติพนธ์ โรจน์เจริญ", role: "Senior Foreman", phone: "092-1549484", tel: "0921549484", badgeColor: "#3b82f6", badgeBg: "rgba(59, 130, 246, 0.15)" },
    { name: "นุชนาฎ คำผุย", role: "Senior Foreman", phone: "095-2925300", tel: "0952925300", badgeColor: "#3b82f6", badgeBg: "rgba(59, 130, 246, 0.15)" },
    { name: "นิธิกุล ค่อมสิงห์", role: "Senior Foreman", phone: "083-5607583", tel: "0835607583", badgeColor: "#3b82f6", badgeBg: "rgba(59, 130, 246, 0.15)" },
    { name: "ทินกร บุญฤทธิ์", role: "Senior Foreman", phone: "064-5633436", tel: "0645633436", badgeColor: "#3b82f6", badgeBg: "rgba(59, 130, 246, 0.15)" },
    { name: "พัฒน์สุวิชญ์ ช่างปรุง", role: "Monitoring", phone: "093-0086423", tel: "0930086423", badgeColor: "#06b6d4", badgeBg: "rgba(6, 182, 212, 0.15)" },
    { name: "ณัฐพงษ์ ภักโสภา", role: "Foreman", phone: "097-2195192", tel: "0972195192", badgeColor: "#10b981", badgeBg: "rgba(16, 185, 129, 0.15)" },
    { name: "พรชัย สุภาษร", role: "Foreman", phone: "064-3358286", tel: "0643358286", badgeColor: "#10b981", badgeBg: "rgba(16, 185, 129, 0.15)" },
    { name: "พงษ์ภิวัฒน์ โปรถนัด", role: "Foreman", phone: "094-2954442", tel: "0942954442", badgeColor: "#10b981", badgeBg: "rgba(16, 185, 129, 0.15)" },
    { name: "อรุณ ฝ่ายแก้ว", role: "Foreman", phone: "094-1931170", tel: "0941931170", badgeColor: "#10b981", badgeBg: "rgba(16, 185, 129, 0.15)" },
    { name: "ธราดล เม็งไธสง", role: "Foreman", phone: "083-9411741", tel: "0839411741", badgeColor: "#10b981", badgeBg: "rgba(16, 185, 129, 0.15)" }
];

let teamMembersList = [];
const storedTeam = localStorage.getItem("solar_team_members");
if (storedTeam) {
    teamMembersList = JSON.parse(storedTeam);
} else {
    teamMembersList = [...defaultTeamMembersList];
    localStorage.setItem("solar_team_members", JSON.stringify(teamMembersList));
}

function renderTeamGrid(query = "") {
    const grid = document.getElementById("team-cards-grid");
    if (!grid) return;

    const q = query.toLowerCase().trim();
    const filtered = teamMembersList.filter(m => 
        m.name.toLowerCase().includes(q) || 
        m.role.toLowerCase().includes(q) || 
        m.phone.includes(q)
    );

    grid.innerHTML = "";
    if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 3rem 0;">ไม่พบรายชื่อผู้เข้าตรวจสอบที่ค้นหา</div>`;
        return;
    }

    filtered.forEach(m => {
        const card = document.createElement("div");
        card.className = "data-card";
        card.style.padding = "1.25rem 1.5rem";
        card.style.marginBottom = "0";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.justifyContent = "space-between";
        card.style.gap = "14px";

        const avatarHtml = m.photo
            ? `<img src="${m.photo}" alt="${m.name}" style="width: 52px; height: 52px; border-radius: 50%; object-fit: cover; border: 2px solid ${m.badgeColor}; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">`
            : `<div style="width: 52px; height: 52px; border-radius: 50%; background: ${m.badgeBg}; border: 1.5px solid ${m.badgeColor}; display: flex; align-items: center; justify-content: center; color: ${m.badgeColor}; flex-shrink: 0; font-weight: 700; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">${m.name.charAt(0)}</div>`;

        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 14px;">
                ${avatarHtml}
                <div>
                    <div style="font-weight: 700; font-size: 1rem; color: var(--text-primary);">${m.name}</div>
                    <span style="display: inline-block; margin-top: 4px; font-size: 0.72rem; font-weight: 600; padding: 2px 8px; border-radius: 12px; background: ${m.badgeBg}; color: ${m.badgeColor}; border: 1px solid ${m.badgeColor};">
                        ${m.role}
                    </span>
                </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--border-color); margin-top: 4px;">
                <a href="tel:${m.tel}" style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--text-secondary); text-decoration: none; font-weight: 500;">
                    <i data-lucide="phone" style="width: 15px; height: 15px; color: var(--primary-solar);"></i>
                    <span>${m.phone}</span>
                </a>
                <button type="button" class="btn btn-outline btn-sm" onclick="selectInspectorForNewReport('${m.name}')" style="padding: 4px 10px; font-size: 0.75rem;">
                    <i data-lucide="file-plus" style="width: 14px; height: 14px;"></i>
                    <span>สร้างรายงาน</span>
                </button>
            </div>
        `;
        grid.appendChild(card);
    });

    if (window.lucide) lucide.createIcons();
}

function selectInspectorForNewReport(name) {
    window.switchTab("new-report");
    const techSelect = document.getElementById("technician-name");
    const techCustom = document.getElementById("technician-name-custom");
    if (techSelect) {
        techSelect.value = name;
        if (techCustom) techCustom.style.display = "none";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const teamSearch = document.getElementById("team-search");
    if (teamSearch) {
        teamSearch.addEventListener("input", (e) => {
            renderTeamGrid(e.target.value);
        });
    }
});

window.selectInspectorForNewReport = selectInspectorForNewReport;
window.renderTeamGrid = renderTeamGrid;

// KKE Master Projects Database (156 sites imported from Google Sheet)
const kkeProjectMasterList = [
    { name: "ธงทองรับเบอร์", province: "มุกดาหาร", district: "เมืองมุกดาหาร", size: "972" },
    { name: "Nachitec", province: "มุกดาหาร", district: "เมืองมุกดาหาร", size: "933.12" },
    { name: "Nachitec 2", province: "มุกดาหาร", district: "เมืองมุกดาหาร", size: "319.2" },
    { name: "Ntec", province: "มุกดาหาร", district: "เมืองมุกดาหาร", size: "2903.04" },
    { name: "Ntec 2", province: "มุกดาหาร", district: "เมืองมุกดาหาร", size: "990" },
    { name: "Vgreen", province: "อุบลราชธานี", district: "เมืองอุบลราชธานี", size: "457.92" },
    { name: "Luangsiri", province: "อุบลราชธานี", district: "เดชอุดม", size: "528" },
    { name: "TIA LIANG", province: "อุบลราชธานี", district: "", size: "532" },
    { name: "โรงสี ต.ไทยเจริญ", province: "ศรีสะเกษ", district: "อุทุมพรพิสัย", size: "399" },
    { name: "PHATTANAKIT WOOD", province: "ศรีสะเกษ", district: "ไพรบึง", size: "316.8" },
    { name: "โรงสีศรีสกลเพียวไรซ์", province: "สกลนคร", district: "เมืองสกลนคร", size: "462" },
    { name: "545 PARAWOOD", province: "หนองคาย", district: "พานไผ่", size: "199.5" },
    { name: "TOYOTA LOEI", province: "เลย", district: "เมืองเลย", size: "194.4" },
    { name: "TOYOTA BURIRAM", province: "บุรีรัมย์", district: "เมืองบุรีรัมย์", size: "233.28" },
    { name: "ไวร์เมช โคราช", province: "โคราช", district: "เมืองนครราชสีมา", size: "276.66" },
    { name: "Procare", province: "ชลบุรี", district: "ศรีราชา", size: "897.75" },
    { name: "A-PLA", province: "ชลบุรี", district: "ศรีราชา", size: "532" },
    { name: "ไวร์เมทชลบุรี", province: "ชลบุรี", district: "เมืองชลบุรี", size: "238.5" },
    { name: "OFFICE CCP", province: "ชลบุรี", district: "เมืองชลบุรี", size: "113.85" },
    { name: "Rika", province: "ชลบุรี", district: "ศรีราชา", size: "0" },
    { name: "Brose", province: "ชลบุรี", district: "ศรีราชา", size: "0" },
    { name: "HIDAKA SUZUTOKU 294.00kWp.", province: "ชลบุรี", district: "ศรีราชา", size: "294" },
    { name: "Raweepat", province: "นครปฐม", district: "", size: "210.16" },
    { name: "AAG", province: "นนทบุรี", district: "ไทรน้อย", size: "300.3" },
    { name: "วรรณภพ", province: "นนทบุรี", district: "บางกรวย", size: "126" },
    { name: "PVO - HEAD OFFICE", province: "นนทบุรี", district: "บางพัด", size: "71.82" },
    { name: "Robison Srisaman", province: "นนทบุรี", district: "ปากเกร็ด", size: "999.34" },
    { name: "Mektec", province: "พระนครศรีอยุธยา", district: "บางปะอิน", size: "335.16" },
    { name: "TPS 1", province: "พระนครศรีอยุธยา", district: "เมืองพระนครศรีอยุธยา", size: "199.5" },
    { name: "TPS 2", province: "พระนครศรีอยุธยา", district: "เมืองพระนครศรีอยุธยา", size: "106.4" },
    { name: "Unity ( บริษัท ยูนิตี้ ฮาร์เนส จำกัด )", province: "พระนครศรีอยุธยา", district: "บางประหัน", size: "310.8" },
    { name: "Robison Lopburi", province: "ลพบุรี", district: "เมืองลพบุรี", size: "999.34" },
    { name: "CCP1", province: "ชลบุรี", district: "บ้านบึง", size: "457.92" },
    { name: "CCP2", province: "ชลบุรี", district: "บ้านบึง", size: "124.02" },
    { name: "CPS", province: "ชลบุรี", district: "บ้านบึง", size: "228.96" },
    { name: "E.Q. RUBBER", province: "ชลบุรี", district: "หนองใหญ่", size: "1330" },
    { name: "TER", province: "ชลบุรี", district: "หนองใหญ่", size: "133" },
    { name: "TER2", province: "ชลบุรี", district: "หนองใหญ่", size: "114.38" },
    { name: "TEM (ไทย อีสเทิร์น ไวร์ เมช)", province: "ชลบุรี", district: "หนองใหญ่", size: "1206.98" },
    { name: "Suksoombon Farm", province: "ชลบุรี", district: "หนองใหญ่", size: "1323" },
    { name: "Pisamai", province: "ราชบุรี", district: "เมืองราชบุรี", size: "112" },
    { name: "ดำรงวนิช", province: "สมุทรสาคร", district: "เมืองสมุทรสาคร", size: "526.68" },
    { name: "Roland Digital", province: "สมุทรสาคร", district: "เมืองสมุทรสาคร", size: "504.57" },
    { name: "DEK SOM BOON", province: "สมุทรสาคร", district: "เมืองสมุทรสาคร", size: "199.5" },
    { name: "GTS", province: "สมุทรสาคร", district: "เมืองสมุทรสาคร", size: "198.8" },
    { name: "JD FOOD", province: "สมุทรสาคร", district: "เมืองสมุทรสาคร", size: "612.48" },
    { name: "PYK. TOOL AND DIE", province: "สมุทรสาคร", district: "เมืองสมุทรสาคร", size: "113.6" },
    { name: "PHATTHANA FROZEN", province: "สมุทรสาคร", district: "", size: "999.6" },
    { name: "CJ Manufacturing", province: "สมุทรปราการ", district: "บางบ่อ", size: "532" },
    { name: "Eternal Resin", province: "สมุทรปราการ", district: "บางเสาธง", size: "888.3" },
    { name: "Bulk (Eternal Resin)", province: "สมุทรปราการ", district: "บางเสาธง", size: "126" },
    { name: "BMC (Eternal Resin)", province: "สมุทรปราการ", district: "บางเสาธง", size: "138.6" },
    { name: "TOA", province: "สมุทรปราการ", district: "บางเสาธง", size: "1274.14" },
    { name: "United บางพลี", province: "สมุทรปราการ", district: "บางพลี", size: "999.36" },
    { name: "IJTT", province: "ชลบุรี", district: "เมืองชลบุรี", size: "1513.54" },
    { name: "Seah", province: "ชลบุรี", district: "พานทอง", size: "1431.08" },
    { name: "J-Filter", province: "ชลบุรี", district: "พานทอง", size: "82.94" },
    { name: "Interroll (Thailand)", province: "ชลบุรี", district: "พานทอง", size: "128.7" },
    { name: "BO-thongrubber", province: "ชลบุรี", district: "บ่อทอง", size: "987.36" },
    { name: "Siam Cans Industry", province: "ชลบุรี", district: "บ่อทอง", size: "198.8" },
    { name: "ทองไทย 1", province: "จันทบุรี", district: "แก่งหางแมว", size: "792" },
    { name: "ทองไทย 2", province: "จันทบุรี", district: "แก่งหางแมว", size: "198" },
    { name: "ทองไทย 3", province: "จันทบุรี", district: "แก่งหางแมว", size: "1008" },
    { name: "RC Farm 2", province: "ตราด", district: "เมืองตราด", size: "119.7" },
    { name: "RC Farm 1", province: "ตราด", district: "เมืองตราด", size: "266" },
    { name: "YKSD solar", province: "จันทบุรี", district: "สอยดาว", size: "249.48" },
    { name: "อารีชัย", province: "สระแก้ว", district: "เมืองสระแก้ว", size: "371.8" },
    { name: "โชควัฒนา", province: "สระแก้ว", district: "เมืองสระแก้ว", size: "0" },
    { name: "Hidaka 1 (353)", province: "สมุทรปราการ", district: "อำเภอเมือง", size: "371" },
    { name: "Hidaka 2 (399)", province: "สมุทรปราการ", district: "อำเภอเมือง", size: "200.2" },
    { name: "Siam Paragon Solutions", province: "สมุทรปราการ", district: "บางพลี", size: "127.8" },
    { name: "Alumet", province: "ฉะเชิงเทรา", district: "บางปะกง", size: "2002.14" },
    { name: "SAMCHAI", province: "สมุทรปราการ", district: "", size: "504" },
    { name: "APC", province: "กรุงเทพ", district: "บางเขน", size: "142" },
    { name: "A.J. Plast", province: "ชลบุรี", district: "บางขุนเทียน", size: "4260" },
    { name: "PVO - ENGINEERING", province: "ปทุมธานี", district: "ปทุมธานี", size: "411" },
    { name: "PVO - CANTEEN", province: "ปทุมธานี", district: "ปทุมธานี", size: "82.2" },
    { name: "PVO - DF3", province: "ปทุมธานี", district: "ปทุมธานี", size: "575.4" },
    { name: "Sun flour Ph.1", province: "ปทุมธานี", district: "คลองหลวง", size: "184.6" },
    { name: "First Confectionery", province: "กรุงเทพมหานคร", district: "บางขุนเทียน", size: "602" },
    { name: "TS. Industry", province: "กรุงเทพ", district: "บางขุนเทียน", size: "313.2" },
    { name: "SCI Corporation", province: "สมุทรสาคร", district: "", size: "99.4" },
    { name: "KANTANG 1", province: "ตรัง", district: "กันตัง", size: "585.2" },
    { name: "KANTANG 2", province: "ตรัง", district: "กันตัง", size: "651.7" },
    { name: "Suksomboon", province: "พังงา", district: "คุระบุรี", size: "319.2" },
    { name: "Siam Chicken", province: "กระบี่", district: "พระยา", size: "372.4" },
    { name: "R89", province: "ระนอง", district: "เมืองระนอง", size: "399" },
    { name: "TPK", province: "ระนอง", district: "เมืองระนอง", size: "127.68" },
    { name: "PETPAL", province: "สระบุรี", district: "หนองแค", size: "999.68" },
    { name: "TOTO โรงงาน 3", province: "สระบุรี", district: "หนองปลาหมอ", size: "886.08" },
    { name: "ซันฟู้ด", province: "สระบุรี", district: "วังม่วง", size: "7722" },
    { name: "PCC", province: "เชียงใหม่", district: "เมืองเชียงใหม่", size: "186.3" },
    { name: "Hexa", province: "เชียงใหม่", district: "สันทราย", size: "241.92" },
    { name: "JPT", province: "เชียงใหม่", district: "สันป่าตอง", size: "40.5" },
    { name: "NR_B", province: "ขอนแก่น", district: "หนองเรือ", size: "361.46" },
    { name: "NR_F", province: "ขอนแก่น", district: "หนองเรือ", size: "829.4" },
    { name: "NR Phase 3", province: "ขอนแก่น", district: "หนองเรือ", size: "301.32" },
    { name: "NR Phase 4", province: "ขอนแก่น", district: "หนองเรือ", size: "871.2" },
    { name: "KFI Phase 1", province: "ขอนแก่น", district: "หนองเรือ", size: "600.6" },
    { name: "KFI Phase 2", province: "ขอนแก่น", district: "หนองเรือ", size: "179.01" },
    { name: "NR Farm", province: "ขอนแก่น", district: "หนองเรือ", size: "132" },
    { name: "KKF Phase 1", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "680.4" },
    { name: "KKF Phase 2", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "475.2" },
    { name: "KR Plastic Phase3", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "286.44" },
    { name: "KR Plastic Phase1", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "975" },
    { name: "KR Plastic Phase2", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "1020.6" },
    { name: "BWC", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "858" },
    { name: "KC", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "924" },
    { name: "KC-2", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "620.4" },
    { name: "Auto Motion Work", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "221" },
    { name: "ไวร์เมช ขอนแก่น", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "385.02" },
    { name: "คลังไวเมท 1", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "401.76" },
    { name: "คลังไวเมท 2", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "345.6" },
    { name: "คลังไวเมท 3", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "211.2" },
    { name: "ภูมิสุข", province: "ขอนแก่น", district: "เมืองพล", size: "194.4" },
    { name: "Prime", province: "ขอนแก่น", district: "บ้านแฮด", size: "425.6" },
    { name: "The Carpet Maker", province: "ขอนแก่น", district: "บ้านแฮด", size: "336" },
    { name: "Thai - Sup", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "554.4" },
    { name: "TOYOTA SRICHAN", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "109" },
    { name: "Nissan KKT", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "211.2" },
    { name: "TOYOTA KHONKEN HEAD OFFICE", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "307.8" },
    { name: "Mitsu ขอนแก่น", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "91.8" },
    { name: "Mitsu ขอนแก่น 2", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "10.8" },
    { name: "Toyota Kaennakorn", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "198" },
    { name: "ม.ภาค", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "187.44" },
    { name: "Toyota amata", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "199.5" },
    { name: "Forest Water", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "378" },
    { name: "FAILY PLAZA KK", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "623.7" },
    { name: "โรงน้ำแข็งกู่ทอง", province: "ขอนแก่น", district: "เชียงยืน", size: "308.7" },
    { name: "Buatip", province: "มหาสารคาม", district: "เชียงยืน", size: "772.2" },
    { name: "Mitsu ชุมแพ", province: "ขอนแก่น", district: "ชุมแพ", size: "51.84" },
    { name: "TOYOTA MALIWAN", province: "ขอนแก่น", district: "ชุมแพ", size: "174.42" },
    { name: "Sentosa Khonkaen(Sila)", province: "ขอนแก่น", district: "เมืองขอนแก่น", size: "138.6" },
    { name: "Chawalit Rice", province: "มหาสารคาม", district: "วาปีปทุม", size: "316.8" },
    { name: "CY Phase 1", province: "มหาสารคาม", district: "เชียงยืน", size: "585" },
    { name: "CY Phase 3", province: "มหาสารคาม", district: "เชียงยืน", size: "552.42" },
    { name: "CY Phase 4+5", province: "มหาสารคาม", district: "เชียงยืน", size: "1219" },
    { name: "CY Phase 2", province: "มหาสารคาม", district: "เชียงยืน", size: "343.2" },
    { name: "เหล่าพัฒนา", province: "มหาสารคาม", district: "เชียงยืน", size: "119.04" },
    { name: "PTT 7-11 E1", province: "มหาสารคาม", district: "เมืองมหาสารคาม", size: "25.85" },
    { name: "PTT E1", province: "มหาสารคาม", district: "เมืองมหาสารคาม", size: "58.32" },
    { name: "PTT 7-11 E2", province: "มหาสารคาม", district: "เมืองมหาสารคาม", size: "25.85" },
    { name: "PTT E2", province: "มหาสารคาม", district: "เมืองมหาสารคาม", size: "38.88" },
    { name: "PTT 7-11 E3", province: "มหาสารคาม", district: "เมืองมหาสารคาม", size: "25.85" },
    { name: "PTT E3", province: "มหาสารคาม", district: "เมืองมหาสารคาม", size: "58.32" },
    { name: "PTT 7-11 E5", province: "มหาสารคาม", district: "เมืองมหาสารคาม", size: "25.85" },
    { name: "PTT E5", province: "มหาสารคาม", district: "เมืองมหาสารคาม", size: "68.04" },
    { name: "PTT chester grill", province: "มหาสารคาม", district: "เมืองมหาสารคาม", size: "34.56" }
];

function initProjectAutocomplete() {
    const datalist = document.getElementById("kke-projects-list");
    const customerInput = document.getElementById("customer-name");
    const locationInput = document.getElementById("installation-location");
    const sizeInput = document.getElementById("system-size");

    if (datalist) {
        datalist.innerHTML = "";
        kkeProjectMasterList.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.name;
            datalist.appendChild(opt);
        });
    }

    if (customerInput) {
        const handleAutoFill = () => {
            const val = customerInput.value.trim();
            const match = kkeProjectMasterList.find(p => p.name.toLowerCase() === val.toLowerCase());
            if (match) {
                if (sizeInput) {
                    sizeInput.value = match.size ? `${match.size} kWp` : "";
                }
            }
        };

        customerInput.addEventListener("input", handleAutoFill);
        customerInput.addEventListener("change", handleAutoFill);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initProjectAutocomplete();

    // Event listeners for site master tab search & filter
    const siteSearchInput = document.getElementById("site-search-input");
    const siteZoneFilter = document.getElementById("site-zone-filter");
    const siteStatusFilter = document.getElementById("site-status-filter");

    if (siteSearchInput) siteSearchInput.addEventListener("input", renderSitesTable);
    if (siteZoneFilter) siteZoneFilter.addEventListener("change", renderSitesTable);
    if (siteStatusFilter) siteStatusFilter.addEventListener("change", renderSitesTable);
});

let currentCalendarYear = new Date().getFullYear();
let currentCalendarMonth = new Date().getMonth(); // 0-indexed

const thaiMonthNames = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

function renderSitesTable() {
    const tbody = document.getElementById("sites-master-table-body");
    if (!tbody) return;

    const searchQuery = document.getElementById("site-search-input")?.value.toLowerCase().trim() || "";
    const zoneFilter = document.getElementById("site-zone-filter")?.value || "all";

    let totalKwpSum = 0;
    let inspectedCount = 0;

    const reportByCustomer = {};
    reports.forEach(r => {
        if (r.customerName) {
            reportByCustomer[r.customerName.toLowerCase().trim()] = r;
        }
    });

    const filteredSites = kkeProjectMasterList.filter(s => {
        const sizeNum = parseFloat(s.size) || 0;
        totalKwpSum += sizeNum;

        const custNameLower = s.name.toLowerCase().trim();
        const matchedReport = reportByCustomer[custNameLower] || reports.find(r => r.customerName && r.customerName.toLowerCase().includes(custNameLower));

        if (matchedReport) inspectedCount++;

        const matchSearch = !searchQuery || 
            s.name.toLowerCase().includes(searchQuery) || 
            s.province.toLowerCase().includes(searchQuery) || 
            s.district.toLowerCase().includes(searchQuery);

        const matchZone = zoneFilter === "all" || s.zone === zoneFilter;

        return matchSearch && matchZone;
    });

    const totalCount = kkeProjectMasterList.length;
    const inspectedRatio = totalCount > 0 ? Math.round((inspectedCount / totalCount) * 100) : 0;

    const kpiTotalEl = document.getElementById("site-kpi-total");
    const kpiKwpEl = document.getElementById("site-kpi-kwp");
    const kpiInspectedEl = document.getElementById("site-kpi-inspected");
    const kpiRatioEl = document.getElementById("site-kpi-ratio");

    if (kpiTotalEl) kpiTotalEl.innerText = totalCount;
    if (kpiKwpEl) kpiKwpEl.innerText = `${totalKwpSum.toLocaleString('en-US', {maximumFractionDigits: 1})} kWp`;
    if (kpiInspectedEl) kpiInspectedEl.innerText = inspectedCount;
    if (kpiRatioEl) kpiRatioEl.innerText = `${inspectedRatio}%`;

    tbody.innerHTML = "";

    if (filteredSites.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2.5rem; color: var(--text-secondary);">ไม่พบข้อมูลไซต์งานที่ตรงกับเงื่อนไขการค้นหา</td></tr>`;
        return;
    }

    filteredSites.forEach((s, idx) => {
        const tr = document.createElement("tr");

        const actionHtml = `<button type="button" class="btn btn-primary btn-sm" onclick="selectSiteForNewReport('${s.name}')" style="padding: 4px 10px; font-size: 0.78rem;"><i data-lucide="plus" style="width: 14px; height: 14px;"></i> <span>ออกรายงาน</span></button>`;

        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td>
                <strong style="color: var(--text-primary); font-size: 0.92rem;">${s.name}</strong>
                ${s.zone ? `<span style="display: block; font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">${s.zone}</span>` : ''}
            </td>
            <td><span style="font-weight: 700; color: var(--primary-solar);">${s.size}</span> kWp</td>
            <td style="text-align: right;">${actionHtml}</td>
        `;

        tbody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();
}

// Helper function to robustly parse report dates (supports ISO, Thai format e.g. "21 ก.ค. 2569", etc.)
function parseReportDate(dateVal) {
    if (!dateVal) return null;
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) return dateVal;
    
    const str = String(dateVal).trim();
    
    // ISO YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
        return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    }
    
    // Thai format "21 ก.ค. 2569" or "21 กรกฎาคม 2569"
    const thaiMonthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const thaiMonthsFull = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    
    for (let i = 0; i < 12; i++) {
        if (str.includes(thaiMonthsShort[i]) || str.includes(thaiMonthsFull[i])) {
            const parts = str.split(/\s+/);
            const day = parseInt(parts[0]) || 1;
            let year = parseInt(parts[parts.length - 1]) || new Date().getFullYear();
            if (year > 2400) year -= 543;
            return new Date(year, i, day);
        }
    }

    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    return null;
}

function proceedWithUpload(report, webhookUrl, scaleVal, qualityVal, windowWidthVal) {
    const syncModal = document.getElementById("drive-sync-modal");
    const loadingIcon = document.getElementById("drive-sync-loading-icon");
    const successIcon = document.getElementById("drive-sync-success-icon");
    const errorIcon = document.getElementById("drive-sync-error-icon");
    const statusTitle = document.getElementById("drive-sync-status-title");
    const statusMsg = document.getElementById("drive-sync-status-message");
    const actionContainer = document.getElementById("drive-sync-action-container");
    const folderLnk = document.getElementById("lnk-drive-folder");

    // Initialize Modal States
    if (syncModal) syncModal.style.display = "flex";
    if (loadingIcon) loadingIcon.style.display = "block";
    if (successIcon) successIcon.style.display = "none";
    if (errorIcon) errorIcon.style.display = "none";
    if (statusTitle) statusTitle.innerText = "กำลังประมวลผล PDF...";
    if (statusMsg) statusMsg.innerText = "ระบบกำลังจัดระเบียบหน้าและแปลงโครงสร้างกระดาษรายงาน...";
    if (actionContainer) actionContainer.style.display = "none";

    // Setup html2pdf options
    const element = document.getElementById("report-printable-area");
    
    // Temporarily switch active tab to tab-report-view to force browser layout engine to render it at full size
    const originalActiveTab = document.querySelector(".tab-content.active");
    const reportTab = document.getElementById("tab-report-view");
    if (originalActiveTab && reportTab && originalActiveTab !== reportTab) {
        originalActiveTab.classList.remove("active");
        reportTab.classList.add("active");
    }

    // Add rendering-pdf helper class to format paper
    element.classList.add("rendering-pdf");

    // Build html2canvas options
    const html2canvasOpts = {
        scale: scaleVal, 
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    };
    
    if (windowWidthVal !== "auto") {
        const wWidth = parseInt(windowWidthVal) || 794;
        html2canvasOpts.width = wWidth;
        html2canvasOpts.windowWidth = wWidth;
    }

    const opt = {
        margin:       [12.5, 10, 24, 8], 
        filename:     `${report.id}_${report.customerName}.pdf`,
        image:        { type: 'jpeg', quality: qualityVal },
        html2canvas:  html2canvasOpts,
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['css', 'legacy'] }
    };

    // Use html2pdf to generate Base64 PDF from the live element
    const startRender = function() {
        html2pdf().set(opt).from(element).output('datauristring').then(function(pdfDataUri) {
            // Restore original active tab and remove helper class
            element.classList.remove("rendering-pdf");
            if (originalActiveTab && reportTab && originalActiveTab !== reportTab) {
                reportTab.classList.remove("active");
                originalActiveTab.classList.add("active");
            }
            
            // Extract pure base64 from Data URI
            const base64Pdf = pdfDataUri.split(',')[1];
            
            if (statusTitle) statusTitle.innerText = "กำลังซิงค์ไฟล์...";
            if (statusMsg) statusMsg.innerText = "กำลังเขียนบันทึกลงใน Google Sheet และอัปโหลดไฟล์ขึ้น Google Drive...";
            
            // Translate type for Google Sheet logging
            let sType = report.maintenanceType || "-";
            if (sType === "Routine Check") sType = "ตรวจระบบตามระยะปกติ";
            if (sType === "Corrective Maintenance") sType = "ซ่อมบำรุงแก้ไข";
            if (sType === "Preventive Maintenance") sType = "บำรุงรักษาเชิงป้องกัน";
            
            // Construct payload
            const payload = {
                fileName: `${report.id}_${report.customerName}.pdf`,
                pdfData: base64Pdf,
                metadata: {
                    jobNumber: report.id,
                    serviceDate: report.maintenanceDate || report.date || "-",
                    customerName: report.customerName || "-",
                    location: report.location || "-",
                    systemSize: report.systemSize ? (String(report.systemSize).toLowerCase().includes('kwp') ? report.systemSize : `${report.systemSize} kWp`) : "-",
                    serviceType: sType,
                    technicians: report.technicianName || "-",
                    status: report.maintenanceType === "Corrective Maintenance" ? (report.cmStatus || "Completed") : "Normal",
                    recommendations: report.recommendations || "ระบบอยู่ในเกณฑ์สมบูรณ์"
                }
            };
    
            // Send POST request to Web App using text/plain to bypass CORS preflight
            fetch(webhookUrl, {
                method: "POST",
                mode: "cors",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify(payload)
            })
            .then(handleFetchResponse)
            .then(res => {
                if (res.status === "success") {
                    if (loadingIcon) loadingIcon.style.display = "none";
                    if (successIcon) successIcon.style.display = "block";
                    if (statusTitle) statusTitle.innerText = "อัปโหลดสำเร็จ!";
                    if (statusMsg) statusMsg.innerText = "บันทึกไฟล์ PDF และประวัติเรียบร้อยแล้ว";
                    
                    // Save main folder URL to localStorage for the sidebar drive link!
                    if (res.mainFolderUrl) {
                        localStorage.setItem("google_drive_main_folder_url", res.mainFolderUrl);
                    }
                    
                    if (folderLnk && res.folderUrl) {
                        folderLnk.href = res.folderUrl;
                        folderLnk.style.display = "flex";
                    } else if (folderLnk) {
                        folderLnk.style.display = "none";
                    }
                    
                    if (actionContainer) actionContainer.style.display = "flex";
                } else {
                    throw new Error(res.message || "Unknown error occurred on Google Apps Script");
                }
            })
            .catch(err => {
                console.error(err);
                if (loadingIcon) loadingIcon.style.display = "none";
                if (errorIcon) errorIcon.style.display = "block";
                if (statusTitle) statusTitle.innerText = "อัปโหลดไม่สำเร็จ";
                if (statusMsg) statusMsg.innerText = `เกิดข้อผิดพลาด: ${err.message || err}`;
                if (folderLnk) folderLnk.style.display = "none";
                if (actionContainer) actionContainer.style.display = "flex";
            });
    
        }).catch(function(err) {
            // Restore original active tab and remove helper class on failure
            element.classList.remove("rendering-pdf");
            if (originalActiveTab && reportTab && originalActiveTab !== reportTab) {
                reportTab.classList.remove("active");
                originalActiveTab.classList.add("active");
            }
            console.error(err);
            if (loadingIcon) loadingIcon.style.display = "none";
            if (errorIcon) errorIcon.style.display = "block";
            if (statusTitle) statusTitle.innerText = "การสร้าง PDF ล้มเหลว";
            if (statusMsg) statusMsg.innerText = `ไม่สามารถจำลองเอกสารได้: ${err.message || err}`;
            if (actionContainer) actionContainer.style.display = "flex";
        });
    };

    // Ensure fonts are loaded first, then wait 250ms for browser layout to stabilize
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function() {
            setTimeout(startRender, 250);
        }).catch(function() {
            setTimeout(startRender, 250);
        });
    } else {
        setTimeout(startRender, 250);
    }
}

// Calendar Renderer Logic
function renderCalendar() {
    const grid = document.getElementById("calendar-days-grid");
    const titleEl = document.getElementById("calendar-month-year-title");
    const eventsList = document.getElementById("calendar-month-events-list");
    const eventsCountEl = document.getElementById("cal-month-events-count");
    const plansList = document.getElementById("calendar-month-plans-list");
    const plansCountEl = document.getElementById("cal-month-plans-count");

    if (!grid || !titleEl) return;

    const yearThai = currentCalendarYear + 543;
    titleEl.innerText = `${thaiMonthNames[currentCalendarMonth]} ${yearThai}`;

    const monthSelect = document.getElementById("cal-month-select");
    const yearSelect = document.getElementById("cal-year-select");

    if (yearSelect && yearSelect.options.length === 0) {
        yearSelect.innerHTML = "";
        const startY = currentCalendarYear - 5;
        const endY = currentCalendarYear + 5;
        for (let y = startY; y <= endY; y++) {
            const opt = document.createElement("option");
            opt.value = y;
            opt.innerText = `ปี ${y + 543}`;
            yearSelect.appendChild(opt);
        }
    }

    if (monthSelect) monthSelect.value = String(currentCalendarMonth);
    if (yearSelect) yearSelect.value = String(currentCalendarYear);

    // Map reports by date string (YYYY-MM-DD)
    const reportsByDate = {};
    const monthlyReports = [];

    reports.forEach(r => {
        const rawDate = r.maintenanceDate || r.date || r.createdAt;
        if (!rawDate) return;
        const d = parseReportDate(rawDate);
        if (d && !isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${day}`;

            if (!reportsByDate[dateStr]) reportsByDate[dateStr] = [];
            reportsByDate[dateStr].push(r);

            if (y === currentCalendarYear && d.getMonth() === currentCalendarMonth) {
                monthlyReports.push(r);
            }
        }
    });

    // Map plans by date string (YYYY-MM-DD)
    const plansByDate = {};
    const monthlyPlans = [];
    let plans = [];
    try {
        const storedPlans = localStorage.getItem("solar_plans");
        if (storedPlans) plans = JSON.parse(storedPlans);
    } catch (e) {
        console.error(e);
    }

    plans.forEach(p => {
        const rawDate = p.date;
        if (!rawDate) return;
        const d = parseReportDate(rawDate);
        if (d && !isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${day}`;

            if (!plansByDate[dateStr]) plansByDate[dateStr] = [];
            plansByDate[dateStr].push(p);

            if (y === currentCalendarYear && d.getMonth() === currentCalendarMonth) {
                monthlyPlans.push(p);
            }
        }
    });

    if (eventsCountEl) eventsCountEl.innerText = monthlyReports.length;
    if (plansCountEl) plansCountEl.innerText = monthlyPlans.length;

    // Days calculation
    const firstDayIndex = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay(); // 0 (Sun) - 6 (Sat)
    const totalDays = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
    const prevMonthDays = new Date(currentCalendarYear, currentCalendarMonth, 0).getDate();

    const today = new Date();
    const todayY = today.getFullYear();
    const todayM = today.getMonth();
    const todayD = today.getDate();

    grid.innerHTML = "";

    // Prev month padding days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
        const dayNum = prevMonthDays - i;
        const cell = document.createElement("div");
        cell.className = "calendar-day-cell other-month";
        cell.innerHTML = `<div class="calendar-day-number">${dayNum}</div>`;
        grid.appendChild(cell);
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
        const cell = document.createElement("div");
        const isToday = (currentCalendarYear === todayY && currentCalendarMonth === todayM && d === todayD);
        cell.className = `calendar-day-cell ${isToday ? 'today' : ''}`;

        // Format date YYYY-MM-DD
        const mStr = String(currentCalendarMonth + 1).padStart(2, '0');
        const dStr = String(d).padStart(2, '0');
        const dateKey = `${currentCalendarYear}-${mStr}-${dStr}`;

        let pillsHtml = "";
        if (reportsByDate[dateKey]) {
            reportsByDate[dateKey].forEach(r => {
                pillsHtml += `
                    <div class="calendar-event-pill" onclick="viewReportDetail('${r.id}')" title="คลิกเพื่อดูรายงาน: ${r.customerName}">
                        <i data-lucide="file-check" style="width: 12px; height: 12px; flex-shrink: 0;"></i>
                        <span>${r.customerName}</span>
                    </div>
                `;
            });
        }
        if (plansByDate[dateKey]) {
            plansByDate[dateKey].forEach(p => {
                pillsHtml += `
                    <div class="calendar-event-pill plan-pill" style="background-color: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.25); color: #60a5fa;" onclick="triggerPlanAction('${p.id}')" title="แผนงาน: ${p.customerName}">
                        <i data-lucide="calendar" style="width: 12px; height: 12px; flex-shrink: 0; color: #60a5fa;"></i>
                        <span style="font-weight: 600;">[แผน] ${p.customerName}</span>
                    </div>
                `;
            });
        }

        cell.innerHTML = `
            <div class="calendar-day-number">${d}</div>
            <div style="overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 4px;">${pillsHtml}</div>
        `;
        grid.appendChild(cell);
    }

    // Next month padding days to fill 35 or 42 grid cells
    const renderedSoFar = firstDayIndex + totalDays;
    const totalCells = renderedSoFar > 35 ? 42 : 35;
    const nextDays = totalCells - renderedSoFar;

    for (let i = 1; i <= nextDays; i++) {
        const cell = document.createElement("div");
        cell.className = "calendar-day-cell other-month";
        cell.innerHTML = `<div class="calendar-day-number">${i}</div>`;
        grid.appendChild(cell);
    }

    // Render monthly events list
    if (eventsList) {
        eventsList.innerHTML = "";
        if (monthlyReports.length === 0) {
            eventsList.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 1.5rem 0;">ไม่มีประวัติการเข้าตรวจเช็คในเดือน ${thaiMonthNames[currentCalendarMonth]} ${yearThai}</div>`;
        } else {
            monthlyReports.sort((a, b) => new Date(b.maintenanceDate || b.date) - new Date(a.maintenanceDate || a.date)).forEach(r => {
                const div = document.createElement("div");
                div.className = "history-item";
                div.style.marginBottom = "0.75rem";
                div.style.padding = "0.85rem 1.15rem";
                const displayDate = formatDateThaiShort(r.maintenanceDate || r.date);
                const displaySize = r.systemSize ? (String(r.systemSize).toLowerCase().includes('kwp') ? r.systemSize : `${r.systemSize} kWp`) : 'N/A';
                div.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; color: var(--status-success); flex-shrink: 0;">
                                <i data-lucide="check" style="width: 18px; height: 18px;"></i>
                            </div>
                            <div>
                                <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">${r.customerName}</div>
                                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
                                    <span>วันที่: ${displayDate}</span> | <span>ผู้ตรวจ: ${r.technicianName || 'N/A'}</span> | <span>ขนาด: ${displaySize}</span>
                                </div>
                            </div>
                        </div>
                        <button type="button" class="btn btn-outline btn-sm" onclick="viewReportDetail('${r.id}')">
                            <i data-lucide="file-text"></i> <span>ดูรายงาน</span>
                        </button>
                    </div>
                `;
                eventsList.appendChild(div);
            });
        }
    }

    // Render monthly plans list
    if (plansList) {
        plansList.innerHTML = "";
        if (monthlyPlans.length === 0) {
            plansList.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 1.5rem 0;">ไม่มีแผนการเข้าตรวจเช็คในเดือน ${thaiMonthNames[currentCalendarMonth]} ${yearThai}</div>`;
        } else {
            monthlyPlans.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(p => {
                const div = document.createElement("div");
                div.className = "history-item";
                div.style.marginBottom = "0.75rem";
                div.style.padding = "0.85rem 1.15rem";
                div.style.borderLeft = "4px solid #3b82f6";
                const displayDate = formatDateThaiShort(p.date);
                const typeLabel = p.maintenanceType === "Corrective Maintenance" ? "CM" : "PM";
                const typeText = p.maintenanceType === "Corrective Maintenance" ? "งานซ่อมแก้ไข (CM)" : "งานบำรุงรักษา (PM)";
                const badgeBg = p.maintenanceType === "Corrective Maintenance" ? "rgba(239, 68, 68, 0.15)" : "rgba(251, 191, 36, 0.15)";
                const badgeColor = p.maintenanceType === "Corrective Maintenance" ? "#ef4444" : "#fbbf24";

                div.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 10px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 220px;">
                            <div style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; color: #3b82f6; flex-shrink: 0;">
                                <i data-lucide="calendar" style="width: 18px; height: 18px;"></i>
                            </div>
                            <div>
                                <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">${p.customerName}</div>
                                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px; line-height: 1.4; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span>วันที่แพลน: ${displayDate}</span>
                                    <span style="font-size: 0.72rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor};">${typeLabel}</span>
                                    <span style="font-size: 0.75rem; color: var(--text-secondary);">(${typeText})</span>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button type="button" class="btn btn-primary btn-sm" onclick="startInspectionFromPlan('${p.id}')" style="background: #3b82f6; border-color: #3b82f6; color: #fff; padding: 4px 10px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px;">
                                <i data-lucide="file-edit" style="width: 14px; height: 14px;"></i> <span>เริ่มเข้าตรวจ</span>
                            </button>
                            <button type="button" class="btn btn-outline btn-sm" onclick="deletePlan('${p.id}')" style="padding: 4px 8px; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05);" title="ลบแผนงาน">
                                <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0;"></i>
                            </button>
                        </div>
                    </div>
                `;
                plansList.appendChild(div);
            });
        }
    }

    if (window.lucide) lucide.createIcons();
}

// Calendar month controls listeners
document.addEventListener("DOMContentLoaded", () => {
    const prevBtn = document.getElementById("cal-prev-month");
    const nextBtn = document.getElementById("cal-next-month");
    const todayBtn = document.getElementById("cal-today-btn");

    const monthSelect = document.getElementById("cal-month-select");
    const yearSelect = document.getElementById("cal-year-select");

    if (monthSelect) {
        monthSelect.addEventListener("change", (e) => {
            currentCalendarMonth = parseInt(e.target.value);
            renderCalendar();
        });
    }

    if (yearSelect) {
        yearSelect.addEventListener("change", (e) => {
            currentCalendarYear = parseInt(e.target.value);
            renderCalendar();
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            currentCalendarMonth--;
            if (currentCalendarMonth < 0) {
                currentCalendarMonth = 11;
                currentCalendarYear--;
            }
            renderCalendar();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            currentCalendarMonth++;
            if (currentCalendarMonth > 11) {
                currentCalendarMonth = 0;
                currentCalendarYear++;
            }
            renderCalendar();
        });
    }

    if (todayBtn) {
        todayBtn.addEventListener("click", () => {
            currentCalendarYear = new Date().getFullYear();
            currentCalendarMonth = new Date().getMonth();
            renderCalendar();
        });
    }

    // Google Drive Settings Modal Event Listeners
    const btnSettingsSidebar = document.getElementById("btn-settings-sidebar");
    const btnSettingsTop = document.getElementById("btn-settings-top");
    const modalSettings = document.getElementById("settings-modal");
    const btnSettingsCancel = document.getElementById("btn-settings-cancel");
    const btnSettingsSave = document.getElementById("btn-settings-save");
    const inputDriveWebhookUrl = document.getElementById("input-drive-webhook-url");

    function openSettings() {
        if (modalSettings) {
            // Load saved webhook URL with default fallback
            const savedUrl = localStorage.getItem("google_drive_webhook_url") || "https://script.google.com/macros/s/AKfycbyyPO7JYaPoit4tNtCwP9sYaSBbilcjda0fHeoUEbat4B1zEMX3UBK9uWVPoyREoY2X5Q/exec";
            if (inputDriveWebhookUrl) inputDriveWebhookUrl.value = savedUrl;
            modalSettings.style.display = "flex";
        }
    }

    if (btnSettingsSidebar) btnSettingsSidebar.addEventListener("click", openSettings);
    if (btnSettingsTop) btnSettingsTop.addEventListener("click", openSettings);

    if (btnSettingsCancel) {
        btnSettingsCancel.addEventListener("click", () => {
            if (modalSettings) modalSettings.style.display = "none";
        });
    }

    if (btnSettingsSave) {
        btnSettingsSave.addEventListener("click", () => {
            if (inputDriveWebhookUrl) {
                const url = inputDriveWebhookUrl.value.trim();
                localStorage.setItem("google_drive_webhook_url", url);
                if (modalSettings) modalSettings.style.display = "none";
                alert("บันทึกการตั้งค่า Google Drive เรียบร้อยแล้ว!");
            }
        });
    }

    // Google Drive Sync Success Modal Closer
    const btnDriveClose = document.getElementById("btn-drive-sync-close");
    const modalDriveSync = document.getElementById("drive-sync-modal");
    if (btnDriveClose && modalDriveSync) {
        btnDriveClose.addEventListener("click", () => {
            modalDriveSync.style.display = "none";
        });
    }
});

function selectSiteForNewReport(siteName) {
    window.switchTab("new-report");
    const customerInput = document.getElementById("customer-name");
    if (customerInput) {
        customerInput.value = siteName;
        // Trigger input event to auto-fill location and systemSize
        customerInput.dispatchEvent(new Event("input"));
        customerInput.dispatchEvent(new Event("change"));
    }
}

// Upload Report to Google Drive Web App
function uploadReportToGoogleDrive(report) {
    const webhookUrl = localStorage.getItem("google_drive_webhook_url") || "https://script.google.com/macros/s/AKfycbyyPO7JYaPoit4tNtCwP9sYaSBbilcjda0fHeoUEbat4B1zEMX3UBK9uWVPoyREoY2X5Q/exec";
    if (!webhookUrl || webhookUrl.trim() === "") {
        // Show settings modal directly if not configured
        const settingsModal = document.getElementById("settings-modal");
        if (settingsModal) {
            settingsModal.style.display = "flex";
            const inputUrl = document.getElementById("input-drive-webhook-url");
            if (inputUrl) inputUrl.focus();
        }
        alert("กรุณาตั้งค่า Google Apps Script Web App URL ก่อนเริ่มใช้งานการซิงค์ข้อมูล");
        return;
    }

    // Show PDF Configuration Modal first
    const pdfConfigModal = document.getElementById("pdf-config-modal");
    if (!pdfConfigModal) {
        // Fallback if modal doesn't exist
        proceedWithUpload(report, webhookUrl, 2.0, 0.98, "794", 70);
        return;
    }

    pdfConfigModal.style.display = "flex";
    if (window.lucide) lucide.createIcons();

    // Setup one-time listeners for PDF config buttons
    const btnCancel = document.getElementById("btn-pdf-config-cancel");
    const btnConfirm = document.getElementById("btn-pdf-config-confirm");

    // Clean up previous event listeners (by replacing elements with their clones)
    const newBtnCancel = btnCancel.cloneNode(true);
    const newBtnConfirm = btnConfirm.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);

    newBtnCancel.addEventListener("click", () => {
        pdfConfigModal.style.display = "none";
    });

    newBtnConfirm.addEventListener("click", () => {
        pdfConfigModal.style.display = "none";
        
        // Read options
        const scaleVal = parseFloat(document.getElementById("export-pdf-scale").value) || 2.0;
        const qualityVal = parseFloat(document.getElementById("export-pdf-quality").value) || 0.98;
        const windowWidthVal = document.getElementById("export-pdf-window-width").value;
        
        // Check if user selected a file manually
        const fileInput = document.getElementById("manual-pdf-upload");
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = function(e) {
                const base64Pdf = e.target.result.split(',')[1];
                proceedWithManualUpload(report, webhookUrl, base64Pdf);
            };
            reader.readAsDataURL(file);
        } else {
            proceedWithUpload(report, webhookUrl, scaleVal, qualityVal, windowWidthVal);
        }
    });
}

// Proceed with PDF generation and Web App upload
function proceedWithUpload(report, webhookUrl, scaleVal, qualityVal, windowWidthVal, topPaddingVal) {
    const syncModal = document.getElementById("drive-sync-modal");
    const loadingIcon = document.getElementById("drive-sync-loading-icon");
    const successIcon = document.getElementById("drive-sync-success-icon");
    const errorIcon = document.getElementById("drive-sync-error-icon");
    const statusTitle = document.getElementById("drive-sync-status-title");
    const statusMsg = document.getElementById("drive-sync-status-message");
    const actionContainer = document.getElementById("drive-sync-action-container");
    const folderLnk = document.getElementById("lnk-drive-folder");

    // Initialize Modal States
    if (syncModal) syncModal.style.display = "flex";
    if (loadingIcon) loadingIcon.style.display = "block";
    if (successIcon) successIcon.style.display = "none";
    if (errorIcon) errorIcon.style.display = "none";
    if (statusTitle) statusTitle.innerText = "กำลังประมวลผล PDF...";
    if (statusMsg) statusMsg.innerText = "ระบบกำลังจัดระเบียบหน้าและแปลงโครงสร้างกระดาษรายงาน...";
    if (actionContainer) actionContainer.style.display = "none";
    updateDriveProgress(0);
    animateDriveProgress(45, 2000);

    // Setup html2pdf options
    const element = document.getElementById("report-printable-area");
    
    // Temporarily switch active tab to tab-report-view to force browser layout engine to render it at full size
    const originalActiveTab = document.querySelector(".tab-content.active");
    const reportTab = document.getElementById("tab-report-view");
    if (originalActiveTab && reportTab && originalActiveTab !== reportTab) {
        originalActiveTab.classList.remove("active");
        reportTab.classList.add("active");
    }

    // Add rendering-pdf helper class to format paper
    element.classList.add("rendering-pdf");
    
    // Temporarily set selected top padding
    const originalPaddingTop = element.style.paddingTop;
    element.style.setProperty("padding-top", topPaddingVal + "px", "important");

    // Build html2canvas options
    const html2canvasOpts = {
        scale: scaleVal, 
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    };
    
    if (windowWidthVal !== "auto") {
        const wWidth = parseInt(windowWidthVal) || 794;
        html2canvasOpts.width = wWidth;
        html2canvasOpts.windowWidth = wWidth;
    }

    const opt = {
        margin:       0, 
        filename:     `${report.id}_${report.customerName}.pdf`,
        image:        { type: 'jpeg', quality: qualityVal },
        html2canvas:  html2canvasOpts,
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['css', 'legacy'] }
    };

    // Use html2pdf to generate Base64 PDF from the live element
    const startRender = function() {
        html2pdf().set(opt).from(element).output('datauristring').then(function(pdfDataUri) {
            // Restore original active tab, padding, and remove helper class
            element.classList.remove("rendering-pdf");
            element.style.paddingTop = originalPaddingTop;
            if (originalActiveTab && reportTab && originalActiveTab !== reportTab) {
                reportTab.classList.remove("active");
                originalActiveTab.classList.add("active");
            }
            
            // Extract base64 from Data URI
            const base64Pdf = pdfDataUri.split(',')[1];
            
            if (statusTitle) statusTitle.innerText = "กำลังอัปโหลดขึ้น Google Drive...";
            if (statusMsg) statusMsg.innerText = "ระบบกำลังบันทึกประวัติการตรวจเช็คลงใน Google Sheets และอัปโหลดไฟล์รายงาน...";
            animateDriveProgress(90, 3000);
    
            // Translate type for Google Sheet logging
            let sType = report.maintenanceType || "-";
            if (sType === "Routine Check") sType = "ตรวจระบบตามระยะปกติ";
            if (sType === "Corrective Maintenance") sType = "ซ่อมบำรุงแก้ไข";
            if (sType === "Preventive Maintenance") sType = "บำรุงรักษาเชิงป้องกัน";
    
            // Construct payload
            const payload = {
                fileName: `${report.id}_${report.customerName}.pdf`,
                pdfData: base64Pdf,
                metadata: {
                    jobNumber: report.id,
                    serviceDate: report.maintenanceDate || report.date || "-",
                    customerName: report.customerName || "-",
                    location: report.location || "-",
                    systemSize: report.systemSize ? (String(report.systemSize).toLowerCase().includes('kwp') ? report.systemSize : `${report.systemSize} kWp`) : "-",
                    serviceType: sType,
                    technicians: report.technicianName || "-",
                    status: report.maintenanceType === "Corrective Maintenance" ? (report.cmStatus || "Completed") : "Normal",
                    recommendations: report.recommendations || "ระบบอยู่ในเกณฑ์สมบูรณ์"
                }
            };
    
            // Send POST request to Web App using text/plain to bypass CORS preflight
            fetch(webhookUrl, {
                method: "POST",
                mode: "cors",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify(payload)
            })
            .then(handleFetchResponse)
            .then(res => {
                if (res.status === "success") {
                    if (loadingIcon) loadingIcon.style.display = "none";
                    if (successIcon) successIcon.style.display = "block";
                    if (statusTitle) statusTitle.innerText = "อัปโหลดสำเร็จ!";
                    if (statusMsg) statusMsg.innerText = "บันทึกไฟล์ PDF และประวัติเรียบร้อยแล้ว";
                    
                    // Save main folder URL to localStorage for the sidebar drive link!
                    if (res.mainFolderUrl) {
                        localStorage.setItem("google_drive_main_folder_url", res.mainFolderUrl);
                    }
                    
                    if (folderLnk && res.folderUrl) {
                        folderLnk.href = res.folderUrl;
                        folderLnk.style.display = "flex";
                    } else if (folderLnk) {
                        folderLnk.style.display = "none";
                    }
                    
                    if (actionContainer) actionContainer.style.display = "flex";
                } else {
                    throw new Error(res.message || "Unknown error occurred on Google Apps Script");
                }
            })
            .catch(err => {
                console.error(err);
                if (loadingIcon) loadingIcon.style.display = "none";
                if (errorIcon) errorIcon.style.display = "block";
                if (statusTitle) statusTitle.innerText = "อัปโหลดไม่สำเร็จ";
                if (statusMsg) statusMsg.innerText = `เกิดข้อผิดพลาด: ${err.message || err}`;
                if (folderLnk) folderLnk.style.display = "none";
                if (actionContainer) actionContainer.style.display = "flex";
            });
    
        }).catch(function(err) {
            // Restore original active tab, padding, and remove helper class on failure
            element.classList.remove("rendering-pdf");
            element.style.paddingTop = originalPaddingTop;
            if (originalActiveTab && reportTab && originalActiveTab !== reportTab) {
                reportTab.classList.remove("active");
                originalActiveTab.classList.add("active");
            }
            console.error(err);
            if (loadingIcon) loadingIcon.style.display = "none";
            if (errorIcon) errorIcon.style.display = "block";
            if (statusTitle) statusTitle.innerText = "การสร้าง PDF ล้มเหลว";
            if (statusMsg) statusMsg.innerText = `ไม่สามารถจำลองเอกสารได้: ${err.message || err}`;
            if (actionContainer) actionContainer.style.display = "flex";
        });
    };

    // Ensure fonts are loaded first, then wait 250ms for browser layout to stabilize
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function() {
            setTimeout(startRender, 250);
        }).catch(function() {
            setTimeout(startRender, 250);
        });
    } else {
        setTimeout(startRender, 250);
    }
}

// Proceed with manual PDF upload to Web App
function proceedWithManualUpload(report, webhookUrl, base64Pdf) {
    const syncModal = document.getElementById("drive-sync-modal");
    const loadingIcon = document.getElementById("drive-sync-loading-icon");
    const successIcon = document.getElementById("drive-sync-success-icon");
    const errorIcon = document.getElementById("drive-sync-error-icon");
    const statusTitle = document.getElementById("drive-sync-status-title");
    const statusMsg = document.getElementById("drive-sync-status-message");
    const actionContainer = document.getElementById("drive-sync-action-container");
    const folderLnk = document.getElementById("lnk-drive-folder");

    // Initialize Modal States
    if (syncModal) syncModal.style.display = "flex";
    if (loadingIcon) loadingIcon.style.display = "block";
    if (successIcon) successIcon.style.display = "none";
    if (errorIcon) errorIcon.style.display = "none";
    if (statusTitle) statusTitle.innerText = "กำลังอัปโหลดไฟล์...";
    if (statusMsg) statusMsg.innerText = "กำลังนำส่งไฟล์ PDF ที่เลือกขึ้นสู่ Google Drive...";
    if (actionContainer) actionContainer.style.display = "none";
    updateDriveProgress(0);
    animateDriveProgress(90, 3000);

    // Clear file input for next time
    const fileInput = document.getElementById("manual-pdf-upload");
    if (fileInput) fileInput.value = "";

    // Translate type for Google Sheet logging
    let sType = report.maintenanceType || "-";
    if (sType === "Routine Check") sType = "ตรวจระบบตามระยะปกติ";
    if (sType === "Corrective Maintenance") sType = "ซ่อมบำรุงแก้ไข";
    if (sType === "Preventive Maintenance") sType = "บำรุงรักษาเชิงป้องกัน";

    // Construct payload
    const payload = {
        fileName: `${report.id}_${report.customerName}.pdf`,
        pdfData: base64Pdf,
        metadata: {
            jobNumber: report.id,
            serviceDate: report.maintenanceDate || report.date || "-",
            customerName: report.customerName || "-",
            location: report.location || "-",
            systemSize: report.systemSize ? (String(report.systemSize).toLowerCase().includes('kwp') ? report.systemSize : `${report.systemSize} kWp`) : "-",
            serviceType: sType,
            technicians: report.technicianName || "-",
            status: report.maintenanceType === "Corrective Maintenance" ? (report.cmStatus || "Completed") : "Normal",
            recommendations: report.recommendations || "ระบบอยู่ในเกณฑ์สมบูรณ์"
        }
    };

    // Send POST request to Web App using text/plain to bypass CORS preflight
    fetch(webhookUrl, {
        method: "POST",
        mode: "cors",
        headers: {
            "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(payload)
    })
    .then(handleFetchResponse)
    .then(res => {
        if (res.status === "success") {
            updateDriveProgress(100);
            if (loadingIcon) loadingIcon.style.display = "none";
            if (successIcon) successIcon.style.display = "block";
            if (statusTitle) statusTitle.innerText = "อัปโหลดสำเร็จ!";
            if (statusMsg) statusMsg.innerText = "บันทึกไฟล์ PDF และประวัติเรียบร้อยแล้ว";
            
            // Save main folder URL to localStorage for the sidebar drive link!
            if (res.mainFolderUrl) {
                localStorage.setItem("google_drive_main_folder_url", res.mainFolderUrl);
            }
            
            if (folderLnk && res.folderUrl) {
                folderLnk.href = res.folderUrl;
                folderLnk.style.display = "flex";
            } else if (folderLnk) {
                folderLnk.style.display = "none";
            }
            
            if (actionContainer) actionContainer.style.display = "flex";
        } else {
            throw new Error(res.message || "Unknown error occurred on Google Apps Script");
        }
    })
    .catch(err => {
        console.error(err);
        if (loadingIcon) loadingIcon.style.display = "none";
        if (errorIcon) errorIcon.style.display = "block";
        if (statusTitle) statusTitle.innerText = "อัปโหลดไม่สำเร็จ";
        if (statusMsg) statusMsg.innerText = `เกิดข้อผิดพลาด: ${err.message || err}`;
        if (folderLnk) folderLnk.style.display = "none";
        if (actionContainer) actionContainer.style.display = "flex";
    });
}

window.renderSitesTable = renderSitesTable;
window.renderCalendar = renderCalendar;
window.selectSiteForNewReport = selectSiteForNewReport;
window.uploadReportToGoogleDrive = uploadReportToGoogleDrive;

// Plan to Report Integration & Management Functions
function triggerPlanAction(planId) {
    let plans = [];
    try {
        const storedPlans = localStorage.getItem("solar_plans");
        if (storedPlans) plans = JSON.parse(storedPlans);
    } catch (e) {
        console.error(e);
    }
    
    const plan = plans.find(p => p.id === planId);
    if (!plan) return;
    
    if (confirm(`คุณต้องการเริ่มเขียนรายงานเข้าตรวจเช็คสำหรับไซต์ "${plan.customerName}" หรือไม่?`)) {
        startInspectionFromPlan(planId);
    }
}

function startInspectionFromPlan(planId) {
    let plans = [];
    try {
        const storedPlans = localStorage.getItem("solar_plans");
        if (storedPlans) plans = JSON.parse(storedPlans);
    } catch (e) {
        console.error(e);
    }
    
    const plan = plans.find(p => p.id === planId);
    if (!plan) return;
    
    // Switch to new report tab
    window.switchTab("new-report");
    
    // Autofill fields
    const customerInput = document.getElementById("customer-name");
    const locationInput = document.getElementById("installation-location");
    const sizeInput = document.getElementById("system-size");
    const dateInput = document.getElementById("maintenance-date");
    
    if (customerInput) {
        customerInput.value = plan.customerName || "";
        customerInput.dispatchEvent(new Event("input"));
    }
    if (locationInput) locationInput.value = plan.location || "";
    if (sizeInput) sizeInput.value = plan.systemSize || "";
    if (dateInput) dateInput.value = plan.date || "";
    
    // Auto-check technicians
    const techGrid = document.getElementById("technicians-checkbox-grid");
    if (techGrid && plan.technicians) {
        const checkboxes = techGrid.querySelectorAll("input[type='checkbox']");
        checkboxes.forEach(cb => {
            cb.checked = plan.technicians.includes(cb.value);
        });
        updateSelectedSigner();
    }
}

function deletePlan(planId) {
    if (!confirm("คุณต้องการลบแผนงานตรวจเช็คนี้ใช่หรือไม่?")) return;
    
    let plans = [];
    try {
        const storedPlans = localStorage.getItem("solar_plans");
        if (storedPlans) plans = JSON.parse(storedPlans);
    } catch (e) {
        console.error(e);
    }
    
    plans = plans.filter(p => p.id !== planId);
    localStorage.setItem("solar_plans", JSON.stringify(plans));
    renderCalendar();
}

function renderPlanTechnicianCheckboxes() {
    const container = document.getElementById("plan-technicians-container");
    if (!container) return;
    container.innerHTML = "";
    
    const sortedMembers = [...teamMembersList].sort((a, b) => (roleRank[b.role] || 0) - (roleRank[a.role] || 0));

    sortedMembers.forEach(m => {
        const label = document.createElement("label");
        label.style.cssText = "display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-size: 0.85rem; color: var(--text-primary);";
        label.innerHTML = `
            <input type="checkbox" class="plan-tech-checkbox-item" value="${m.name}" style="width: auto; cursor: pointer;">
            <span>${m.name}</span>
        `;
        container.appendChild(label);
    });
}

// Bind New Modals and Sidebar listeners
document.addEventListener("DOMContentLoaded", () => {
    // 1. Open Google Drive Link (Always open the main KKE folder)
    const btnSidebarDrive = document.getElementById("btn-sidebar-drive");
    if (btnSidebarDrive) {
        btnSidebarDrive.addEventListener("click", () => {
            const savedFolderUrl = localStorage.getItem("google_drive_main_folder_url") || "https://drive.google.com/drive/folders/1hEiKDf8VtQpIOOCX7kZxaXAn0e4TxpVT";
            window.open(savedFolderUrl, "_blank");
        });
    }

    // 2. Team additions
    const btnAddTeamMember = document.getElementById("btn-add-team-member");
    const modalAddMember = document.getElementById("add-member-modal");
    const btnAddMemberCancel = document.getElementById("btn-add-member-cancel");
    const btnAddMemberSave = document.getElementById("btn-add-member-save");
    
    if (btnAddTeamMember && modalAddMember) {
        btnAddTeamMember.addEventListener("click", () => {
            document.getElementById("member-name-input").value = "";
            document.getElementById("member-phone-input").value = "";
            modalAddMember.style.display = "flex";
        });
    }
    
    if (btnAddMemberCancel && modalAddMember) {
        btnAddMemberCancel.addEventListener("click", () => {
            modalAddMember.style.display = "none";
        });
    }
    
    if (btnAddMemberSave && modalAddMember) {
        btnAddMemberSave.addEventListener("click", () => {
            const name = document.getElementById("member-name-input").value.trim();
            const role = document.getElementById("member-role-input").value;
            const phone = document.getElementById("member-phone-input").value.trim();
            
            if (!name) {
                alert("กรุณาระบุชื่อ-นามสกุล");
                return;
            }
            
            let color = "#cbd5e1";
            let bg = "rgba(203, 213, 225, 0.15)";
            if (role === "Service Engineer" || role === "Assist Service Engineer") {
                color = "#fbbf24";
                bg = "rgba(251, 191, 36, 0.15)";
            } else if (role === "Senior Foreman") {
                color = "#3b82f6";
                bg = "rgba(59, 130, 246, 0.15)";
            } else if (role === "Foreman") {
                color = "#10b981";
                bg = "rgba(16, 185, 129, 0.15)";
            } else if (role === "Monitoring") {
                color = "#06b6d4";
                bg = "rgba(6, 182, 212, 0.15)";
            }
            
            const newMember = {
                name: name,
                role: role,
                phone: phone || "-",
                tel: phone.replace(/[^0-9]/g, ''),
                badgeColor: color,
                badgeBg: bg
            };
            
            teamMembersList.push(newMember);
            localStorage.setItem("solar_team_members", JSON.stringify(teamMembersList));
            
            modalAddMember.style.display = "none";
            renderTeamGrid();
            renderTechnicianCheckboxes();
            
            alert(`เพิ่มรายชื่อ ${name} ในทีมงานเรียบร้อยแล้ว!`);
        });
    }

    // Populate projects datalist for planning
    const datalist = document.getElementById("plan-projects-datalist");
    if (datalist) {
        datalist.innerHTML = "";
        const uniqueNames = Array.from(new Set(kkeProjectMasterList.map(p => p.name)));
        uniqueNames.sort().forEach(name => {
            const opt = document.createElement("option");
            opt.value = name;
            datalist.appendChild(opt);
        });
    }

    // 3. Plan additions
    const btnAddPlan = document.getElementById("btn-add-plan");
    const modalAddPlan = document.getElementById("add-plan-modal");
    const btnAddPlanCancel = document.getElementById("btn-add-plan-cancel");
    const btnAddPlanSave = document.getElementById("btn-add-plan-save");
    
    if (btnAddPlan && modalAddPlan) {
        btnAddPlan.addEventListener("click", () => {
            // Set default date as today
            const today = new Date().toISOString().split('T')[0];
            document.getElementById("plan-date-input").value = today;
            document.getElementById("plan-site-input").value = "";
            document.getElementById("plan-type-input").value = "Preventive Maintenance";
            
            modalAddPlan.style.display = "flex";
        });
    }
    
    if (btnAddPlanCancel && modalAddPlan) {
        btnAddPlanCancel.addEventListener("click", () => {
            modalAddPlan.style.display = "none";
        });
    }
    
    if (btnAddPlanSave && modalAddPlan) {
        btnAddPlanSave.addEventListener("click", () => {
            const date = document.getElementById("plan-date-input").value;
            const customerName = document.getElementById("plan-site-input").value.trim();
            const maintenanceType = document.getElementById("plan-type-input").value;
            
            if (!date) {
                alert("กรุณาระบุวันที่เข้าตรวจเช็ค");
                return;
            }
            if (!customerName) {
                alert("กรุณาระบุชื่อไซต์งาน / ลูกค้า");
                return;
            }
            
            let plans = [];
            try {
                const storedPlans = localStorage.getItem("solar_plans");
                if (storedPlans) plans = JSON.parse(storedPlans);
            } catch (e) {}
            
            const newPlan = {
                id: "PLAN-" + Date.now(),
                date: date,
                customerName: customerName,
                maintenanceType: maintenanceType
            };
            
            plans.push(newPlan);
            localStorage.setItem("solar_plans", JSON.stringify(plans));
            
            modalAddPlan.style.display = "none";
            renderCalendar();
            
            alert(`บันทึกแผนงานเข้าตรวจเช็คไซต์ ${customerName} สำเร็จ!`);
        });
    }
});

// Exports for global onclick execution
window.triggerPlanAction = triggerPlanAction;
window.startInspectionFromPlan = startInspectionFromPlan;
window.deletePlan = deletePlan;

// Safe fetch response parser to prevent cryptic Unexpected token '<' errors
function handleFetchResponse(response) {
    if (!response.ok) {
        return response.text().then(text => {
            throw new Error(`HTTP ${response.status}: ${text.substring(0, 150)}`);
        });
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.indexOf("application/json") === -1) {
        return response.text().then(text => {
            let cleanMsg = "สคริปต์ Google Apps Script ตอบกลับเป็น HTML (แทนที่จะเป็น JSON)";
            const titleMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
            const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            if (titleMatch && titleMatch[1]) {
                cleanMsg += ` - หัวข้อข้อผิดพลาด: "${titleMatch[1].trim()}"`;
            }
            if (bodyMatch && bodyMatch[1]) {
                const bodyText = bodyMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                if (bodyText.length > 0) {
                    cleanMsg += ` (รายละเอียด: ${bodyText.substring(0, 120)}...)`;
                }
            }
            throw new Error(cleanMsg);
        });
    }
    return response.json();
}

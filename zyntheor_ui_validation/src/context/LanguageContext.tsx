import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'th' | 'en';

export interface Translations {
  [key: string]: {
    th: string;
    en: string;
  };
}

export const DICTIONARY: Translations = {
  // Navigation & Ecosystem
  'nav.ecosystem': { th: 'ระบบนิเวศ', en: 'Ecosystem' },
  'nav.command_center': { th: 'ศูนย์บัญชาการระบบ', en: 'Command Center' },
  'nav.conversational_intelligence': { th: 'ระบบสนทนาอัจฉริยะ', en: 'Conversational AI' },
  'nav.intelligence_core': { th: 'แกนสมองประสาทเทียม', en: 'Intelligence Core' },
  'nav.model_laboratory': { th: 'ห้องปฏิบัติการโมเดล', en: 'Model Laboratory' },
  'nav.dev_studio': { th: 'สตูดิโอนักพัฒนา', en: 'Dev Studio' },
  'nav.automation_center': { th: 'ศูนย์ควบคุมระบบอัตโนมัติ', en: 'Automation Center' },
  'nav.api_platform': { th: 'แพลตฟอร์ม API & นักพัฒนา', en: 'API Platform' },
  'nav.research_lab': { th: 'ห้องวิจัยการเรียนรู้', en: 'Research Lab' },
  'nav.knowledge_hub': { th: 'คลังปัญญาความรู้', en: 'Knowledge Hub' },
  'nav.experiment_center': { th: 'ศูนย์ทดลอง & จำลองผล', en: 'Experiment Center' },
  'nav.marketplace': { th: 'ตลาดทักษะ & มาร์เก็ตเพลส', en: 'Marketplace' },
  'nav.subscription_billing': { th: 'การเงิน & แผนบริการ', en: 'Billing & Plans' },
  'nav.analytics_bi': { th: 'การวิเคราะห์ & ตัวชี้วัดธุรกิจ', en: 'Analytics & BI' },
  'nav.governance_security': { th: 'ธรรมาภิบาล & ความปลอดภัย', en: 'Governance & Security' },
  'nav.admin_console': { th: 'คอนโซลผู้ดูแลระบบ', en: 'Admin Console' },
  'nav.user_settings': { th: 'การตั้งค่าระบบ & ผู้ใช้', en: 'User Settings' },
  'mobile.command': { th: 'หน้าหลัก', en: 'Command' },
  'mobile.studio': { th: 'สร้างงาน', en: 'Studio' },
  'mobile.brain': { th: 'สมอง', en: 'Core' },
  'mobile.analytics': { th: 'วิเคราะห์', en: 'Insights' },
  'mobile.more': { th: 'เพิ่มเติม', en: 'More' },

  // Global shell and live context
  'role.current': { th: 'สิทธิ์ปัจจุบัน', en: 'Current role' },
  'role.User': { th: 'ผู้ใช้', en: 'User' },
  'role.Developer': { th: 'นักพัฒนา', en: 'Developer' },
  'role.Administrator': { th: 'ผู้ดูแลระบบ', en: 'Administrator' },
  'brand.native_intelligence': { th: 'NATIVE INTELLIGENCE', en: 'NATIVE INTELLIGENCE' },
  'status.audit_valid': { th: 'สายตรวจสอบถูกต้อง', en: 'Audit chain valid' },
  'status.audit_check': { th: 'ต้องตรวจสอบสายข้อมูล', en: 'Audit chain needs review' },
  'status.audit_waiting': { th: 'รอข้อมูลตรวจสอบ', en: 'Awaiting audit data' },
  'status.audit_records': { th: 'รายการ', en: 'records' },
  'status.phase_unavailable': { th: 'ยังไม่มีข้อมูลสถานะบริการ', en: 'Service phase unavailable' },
  'header.session_title': { th: 'สถานะเซสชันและสิทธิ์ผู้ใช้', en: 'Session status and user role' },
  'header.sign_in': { th: 'เข้าสู่ระบบ', en: 'Sign in' },
  'context.aria': { th: 'แผงบริบทระบบ', en: 'System context panel' },
  'context.live': { th: 'บริบทเรียลไทม์', en: 'LIVE CONTEXT' },
  'context.collapse': { th: 'ย่อแผงบริบท', en: 'Collapse context panel' },
  'context.open': { th: 'เปิดแผงบริบท', en: 'Open context panel' },
  'context.online_runtime': { th: 'Native Runtime · Online Cloud', en: 'Native Runtime · Online Cloud' },
  'context.runtime': { th: 'รันไทม์', en: 'Runtime' },
  'context.weights_loaded': { th: 'โหลดน้ำหนักโมเดลแล้ว', en: 'WEIGHTS LOADED' },
  'context.checking': { th: 'กำลังตรวจสอบ', en: 'CHECKING' },
  'context.weights_not_loaded': { th: 'ยังไม่ได้โหลดน้ำหนักโมเดล', en: 'WEIGHTS NOT LOADED' },
  'context.no_data': { th: 'ไม่มีข้อมูล', en: 'NO DATA' },
  'context.parameters': { th: 'พารามิเตอร์', en: 'Parameters' },
  'context.throughput': { th: 'ความเร็วประมวลผล', en: 'Throughput' },
  'context.audit_chain': { th: 'สายตรวจสอบ', en: 'Audit chain' },
  'context.valid': { th: 'ถูกต้อง', en: 'VALID' },
  'context.check': { th: 'ต้องตรวจสอบ', en: 'CHECK' },
  'context.memory': { th: 'ความจำ', en: 'Memory' },
  'context.knowledge_scope': { th: 'ขอบเขตองค์ความรู้', en: 'KNOWLEDGE SCOPE' },
  'context.documents_datasets': { th: 'เอกสารและชุดข้อมูล', en: 'Documents & datasets' },
  'context.memory_graph': { th: 'กราฟความจำ', en: 'Memory graph' },
  'context.data_available': { th: 'มีข้อมูลจากระบบ', en: 'data available' },
  'context.tool_access': { th: 'การเข้าถึงเครื่องมือ', en: 'TOOL ACCESS' },
  'context.knowledge_workspace': { th: 'พื้นที่ทำงานองค์ความรู้', en: 'Knowledge workspace' },
  'context.governance_audit': { th: 'ธรรมาภิบาลและการตรวจสอบ', en: 'Governance & audit' },
  'context.developer_required': { th: 'ต้องใช้สิทธิ์นักพัฒนา', en: 'Developer role required' },
  'context.telemetry_refreshed': { th: 'อัปเดตข้อมูลระบบเมื่อ', en: 'Telemetry refreshed' },
  'context.awaiting_telemetry': { th: 'กำลังรอข้อมูลจาก Native Runtime ยังไม่มีการแสดงค่าจำลอง', en: 'Awaiting native runtime telemetry. No mock values are shown.' },

  // Group headers
  'group.operations': { th: 'การปฏิบัติการ & แกนสมอง', en: 'OPERATIONS & CORE' },
  'group.engineering': { th: 'วิศวกรรม & การพัฒนาโค้ด', en: 'ENGINEERING & CODE' },
  'group.reasoning': { th: 'การให้เหตุผล & วิจัย', en: 'REASONING & LAB' },
  'group.business': { th: 'ธุรกิจ & พาณิชย์', en: 'BUSINESS & SAAS' },
  'group.trust': { th: 'ความปลอดภัย & ธรรมาภิบาล', en: 'TRUST & SYSTEM' },

  // Common UI actions
  'btn.run_agent': { th: 'สั่งงาน Sovereign Agent', en: 'Run Sovereign Agent' },
  'btn.run': { th: 'สั่งงาน', en: 'Run' },
  'btn.send': { th: 'ส่งคำสั่ง', en: 'Send' },
  'btn.verify': { th: 'ตรวจสอบ', en: 'Verify' },
  'btn.refresh': { th: 'รีเฟรช', en: 'Refresh' },
  'btn.copy': { th: 'คัดลอก', en: 'Copy' },
  'btn.copied': { th: 'คัดลอกแล้ว', en: 'Copied' },
  'btn.clear': { th: 'ล้างข้อมูล', en: 'Clear' },
  'btn.download': { th: 'ดาวน์โหลด', en: 'Download' },
  'btn.inspect': { th: 'ตรวจสอบเชิงลึก', en: 'Inspect' },
  'btn.filter': { th: 'ตัวกรอง', en: 'Filter' },
  'btn.export': { th: 'ส่งออกข้อมูล', en: 'Export' },
  'btn.search': { th: 'ค้นหา', en: 'Search' },

  // Header badges & status
  'badge.sovereign': { th: 'Native Intelligence · Cloud Runtime', en: 'Native Intelligence · Cloud Runtime' },
  'badge.verified': { th: 'ผ่านการพิสูจน์แล้ว', en: 'Verified' },
  'badge.private_beta': { th: 'ทดสอบเบต้าส่วนตัว (Private Beta)', en: 'Private Beta' },
  'badge.public_beta': { th: 'ทดสอบเบต้าสาธารณะ (Public Beta)', en: 'Public Beta' },
  'badge.commercial_launch': { th: 'เปิดตัวเชิงพาณิชย์ (Commercial)', en: 'Commercial Launch' },
  'footer.sovereign_desc': { th: 'Native Core · Online Cloud Runtime · Fail-Closed Governance', en: 'Native Core · Online Cloud Runtime · Fail-Closed Governance' },

  // Conversational Intelligence
  'chat.title': { th: 'ระบบสนทนาและให้เหตุผลสองภาษา', en: 'Bilingual Conversational & Reasoning Core' },
  'chat.subtitle': { th: 'ใช้ Native Cloud Runtime เมื่อ checkpoint ผ่านการตรวจสอบ และแสดงสถานะจากระบบจริง', en: 'Uses the Native Cloud Runtime after checkpoint verification; status is reported from live system evidence.' },
  'chat.input_placeholder': { th: 'พิมพ์คำถามหรือคำสั่งภาษาไทย หรือ English... (เช่น สร้างฟังก์ชันตรวจสอบสิทธิ์, อธิบายขั้นตอน)', en: 'Type prompt in Thai or English... (e.g. Write an auth validator, explain architecture)' },
  'chat.thinking': { th: 'โมเดลกำลังวิเคราะห์และประมวลผล...', en: 'Model is analyzing and generating tokens...' },
  'chat.thought_process': { th: 'ขั้นตอนการให้เหตุผลที่ตรวจสอบได้ (Verifiable Reasoning)', en: 'Verifiable Reasoning Process' },
  'chat.thought_hide': { th: 'ซ่อนขั้นตอนการคิด', en: 'Hide reasoning steps' },
  'chat.thought_show': { th: 'แสดงขั้นตอนการคิด', en: 'Show reasoning steps' },
  'chat.throughput': { th: 'ความเร็วประมวลผล', en: 'Throughput' },
  'chat.tokens': { th: 'จำนวนโทเค็น', en: 'Total Tokens' },
  'chat.latency': { th: 'เวลาตอบสนองแรก', en: 'Time to First Token' },
  'chat.dual_lang_pill1': { th: 'สร้าง Token Validator พร้อม HMAC-SHA256', en: 'Build Token Validator with HMAC-SHA256' },
  'chat.dual_lang_pill2': { th: 'วิเคราะห์โครงสร้าง Sovereign Sandbox', en: 'Analyze Sovereign Sandbox Architecture' },
  'chat.dual_lang_pill3': { th: 'เขียนโมดูลความจำระยะยาว Episodic Memory', en: 'Write Episodic Memory Storage Module' },
  'chat.dual_lang_pill4': { th: 'ตรวจสอบสถานะความปลอดภัย Runtime Tamper Check', en: 'Check Runtime Sandbox Tamper Verification' },

  // Governance & Security
  'gov.title': { th: 'ระบบธรรมาภิบาล ความปลอดภัย และการตรวจสอบความถูกต้อง', en: 'Governance, Security & Integrity Verification' },
  'gov.tamper_title': { th: 'เครื่องมือตรวจสอบความสมบูรณ์ของ Sandbox (Runtime Tamper Verification)', en: 'Sandbox Runtime Tamper Verification Tool' },
  'gov.tamper_desc': { th: 'รัน No-Op Probe ภายใน /workspace sandbox เพื่อตรวจสอบลายเซ็น SHA-256 เทียบกับ Genesis State และป้องกัน Path Traversal หรือ Symlink Escape', en: 'Executes isolated no-op script inside /workspace sandbox, comparing SHA-256 against Genesis State to prevent path traversal or symlink escapes.' },
  'gov.btn_run_tamper': { th: 'รันการตรวจสอบสภาพแวดล้อม (Execute Tamper Check)', en: 'Execute Sandbox Tamper Verification' },
  'gov.tamper_free': { th: 'สภาพแวดล้อมปลอดภัย ปราศจากการดัดแปลง (TAMPER-FREE)', en: 'Environment Verified Untampered (TAMPER-FREE)' },
  'gov.tamper_detected': { th: 'ตรวจพบความผิดปกติใน Sandbox (TAMPER DETECTED)', en: 'Sandbox Anomaly Detected (TAMPER DETECTED)' },
  'gov.genesis_hash': { th: 'ลายเซ็นตั้งต้น Genesis Hash', en: 'Genesis State Hash' },
  'gov.exec_hash': { th: 'ลายเซ็นการประมวลผล Execution Hash', en: 'Probe Execution Hash' },
  'gov.files_audited': { th: 'ไฟล์ใน Sandbox ที่ตรวจสอบ', en: 'Audited Sandbox Files' },
  'gov.boundary_intact': { th: 'ขอบเขต Sandbox ไม่ถูกเจาะทะลุ', en: 'Sandbox Boundary Intact' },

  // Native Memory Controller
  'mem.title': { th: 'ระบบความจำระยะยาว (Native Episodic Memory)', en: 'Native Episodic Memory Controller' },
  'mem.desc': { th: 'จัดเก็บความจำข้ามเซสชัน ทุกการอ่านและเขียนจะถูกบันทึกลง AuditLedger พร้อม SHA-256 Chain', en: 'Persists memories across sessions. All read/write operations cryptographically audited in SHA-256 ledger.' },
  'mem.store_key': { th: 'คีย์ความจำ (Key)', en: 'Memory Key' },
  'mem.store_value': { th: 'ข้อมูลความจำ (Value)', en: 'Memory Content' },
  'mem.category': { th: 'หมวดหมู่', en: 'Category' },
  'mem.save_btn': { th: 'บันทึกลงความจำ Sovereign', en: 'Store In Sovereign Memory' },
  'mem.total_items': { th: 'ความจำที่บันทึกไว้', en: 'Total Memory Items' },
  'mem.last_persisted': { th: 'บันทึกล่าสุด', en: 'Last Persisted' }
};

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (key: string, fallback?: string) => string;
  formatNumber: (n: number) => string;
  formatDate: (dateStr: string | number | Date) => string;
  formatCurrency: (amount: number) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('zyntheor_lang');
      if (saved === 'en' || saved === 'th') return saved;
    } catch {
      // ignore
    }
    return 'th'; // Default to Thai per core requirement
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
    document.documentElement.dataset.language = lang;
  }, [lang]);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem('zyntheor_lang', newLang);
    } catch {
      // ignore
    }
  };

  const toggleLang = () => {
    setLang(lang === 'th' ? 'en' : 'th');
  };

  const t = (key: string, fallback?: string): string => {
    const entry = DICTIONARY[key];
    if (entry && entry[lang]) {
      return entry[lang];
    }
    return fallback || key;
  };

  const formatNumber = (n: number): string => {
    return new Intl.NumberFormat(lang === 'th' ? 'th-TH' : 'en-US').format(n);
  };

  const formatDate = (dateStr: string | number | Date): string => {
    try {
      const d = new Date(dateStr);
      return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'medium'
      }).format(d);
    } catch {
      return String(dateStr);
    }
  };

  const formatCurrency = (amount: number): string => {
    if (lang === 'th') {
      return `฿${new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount * 35)}`;
    }
    return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
  };

  return (
    <LanguageContext.Provider
      value={{
        lang,
        setLang,
        toggleLang,
        t,
        formatNumber,
        formatDate,
        formatCurrency
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

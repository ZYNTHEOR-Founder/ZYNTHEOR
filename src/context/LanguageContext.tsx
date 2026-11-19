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
  'nav.ecosystem': { th: 'ระบบหลัก', en: 'System' },
  'nav.command_center': { th: 'ศูนย์บัญชาการ', en: 'Command Center' },
  'nav.conversational_intelligence': { th: 'สนทนาอัจฉริยะ', en: 'Conversational AI' },
  'nav.intelligence_core': { th: 'แกนประมวลผลหลัก', en: 'Intelligence Core' },
  'nav.model_laboratory': { th: 'ห้องปฏิบัติการโมเดล', en: 'Model Laboratory' },
  'nav.dev_studio': { th: 'สตูดิโอนักพัฒนา', en: 'Dev Studio' },
  'nav.automation_center': { th: 'ระบบอัตโนมัติ', en: 'Automation Center' },
  'nav.api_platform': { th: 'แพลตฟอร์ม API', en: 'API Platform' },
  'nav.research_lab': { th: 'ห้องวิจัยและทดสอบ', en: 'Research Lab' },
  'nav.knowledge_hub': { th: 'คลังความรู้', en: 'Knowledge Hub' },
  'nav.experiment_center': { th: 'ศูนย์ทดลองโมเดล', en: 'Experiment Center' },
  'nav.marketplace': { th: 'คลังส่วนเสริม', en: 'Marketplace' },
  'nav.subscription_billing': { th: 'แพ็กเกจและการเงิน', en: 'Billing & Plans' },
  'nav.analytics_bi': { th: 'วิเคราะห์ผลลัพธ์งาน', en: 'Execution Insights' },
  'nav.proof_of_intelligence': { th: 'หลักฐานความสามารถ (Proof)', en: 'Proof of Intelligence' },
  'nav.infrastructure_cloud': { th: 'โครงสร้างพื้นฐาน & Cloud', en: 'Infrastructure & Cloud' },
  'nav.governance_security': { th: 'ความปลอดภัย & Audit', en: 'Governance & Evidence' },
  'nav.admin_console': { th: 'จัดการระบบ (Admin)', en: 'Admin Console' },
  'nav.user_settings': { th: 'บัญชีและการตั้งค่า', en: 'Account & Settings' },

  // Group headers
  'group.operations': { th: 'ศูนย์ปฏิบัติการ', en: 'OPERATIONS & CORE' },
  'group.engineering': { th: 'พัฒนาและโค้ด', en: 'ENGINEERING & CODE' },
  'group.reasoning': { th: 'วิจัยและวิเคราะห์', en: 'REASONING & LAB' },
  'group.business': { th: 'บริการและแผนงาน', en: 'BUSINESS & SAAS' },
  'group.trust': { th: 'ความปลอดภัยและระบบ', en: 'TRUST & SYSTEM' },

  // Common UI actions
  'btn.run_agent': { th: 'สั่งงานด่วน', en: 'Quick Run' },
  'btn.run': { th: 'สั่งงาน', en: 'Run' },
  'btn.send': { th: 'ส่งคำสั่ง', en: 'Send' },
  'btn.verify': { th: 'ตรวจสอบ', en: 'Verify' },
  'btn.refresh': { th: 'อัปเดต', en: 'Refresh' },
  'btn.copy': { th: 'คัดลอก', en: 'Copy' },
  'btn.copied': { th: 'คัดลอกแล้ว', en: 'Copied' },
  'btn.clear': { th: 'ล้างข้อมูล', en: 'Clear' },
  'btn.download': { th: 'ดาวน์โหลด', en: 'Download' },
  'btn.inspect': { th: 'ตรวจสอบ', en: 'Inspect' },
  'btn.filter': { th: 'ตัวกรอง', en: 'Filter' },
  'btn.export': { th: 'ส่งออก', en: 'Export' },
  'btn.search': { th: 'ค้นหา', en: 'Search' },

  // Header badges & status
  'badge.sovereign': { th: 'Native Intelligence · Cloud Runtime', en: 'Native Intelligence · Cloud Runtime' },
  'badge.verified': { th: 'ผ่านการตรวจสอบแล้ว', en: 'Verified' },
  'badge.private_beta': { th: 'เบต้าส่วนตัว', en: 'Private Beta' },
  'badge.public_beta': { th: 'เบต้าสาธารณะ', en: 'Public Beta' },
  'badge.commercial_launch': { th: 'เวอร์ชันเต็ม', en: 'Commercial Launch' },
  'footer.sovereign_desc': { th: 'Native Core · Online Cloud Runtime · Fail-Closed Governance', en: 'Native Core · Online Cloud Runtime · Fail-Closed Governance' },

  // Conversational Intelligence
  'chat.title': { th: 'สนทนาอัจฉริยะ (ไทย / English)', en: 'Bilingual Conversational Core' },
  'chat.subtitle': { th: 'ทำงานบน Cloud Runtime จริงเมื่อ Checkpoint พร้อมใช้งาน และแสดงสถานะตามข้อมูลระบบ', en: 'Uses the Native Cloud Runtime after checkpoint verification; status is reported from live system evidence.' },
  'chat.input_placeholder': { th: 'พิมพ์คำสั่งหรือคำถามเป็นภาษาไทย หรือ English... (เช่น สร้างฟังก์ชัน auth, อธิบายโค้ด)', en: 'Type prompt in Thai or English... (e.g. Write an auth validator, explain architecture)' },
  'chat.thinking': { th: 'กำลังวิเคราะห์และประมวลผล...', en: 'Analyzing and generating tokens...' },
  'chat.thought_process': { th: 'ขั้นตอนการให้เหตุผล', en: 'Reasoning Process' },
  'chat.thought_hide': { th: 'ซ่อนขั้นตอน', en: 'Hide steps' },
  'chat.thought_show': { th: 'ดูขั้นตอน', en: 'Show steps' },
  'chat.throughput': { th: 'ความเร็ว', en: 'Throughput' },
  'chat.tokens': { th: 'โทเค็นทั้งหมด', en: 'Total Tokens' },
  'chat.latency': { th: 'เวลาตอบสนองแรก', en: 'Time to First Token' },
  'chat.dual_lang_pill1': { th: 'สร้าง Token Validator พร้อม HMAC-SHA256', en: 'Build Token Validator with HMAC-SHA256' },
  'chat.dual_lang_pill2': { th: 'วิเคราะห์โครงสร้าง /workspace Sandbox', en: 'Analyze Sovereign Sandbox Architecture' },
  'chat.dual_lang_pill3': { th: 'เขียนโมดูลความจำ Episodic Memory', en: 'Write Episodic Memory Storage Module' },
  'chat.dual_lang_pill4': { th: 'ตรวจสถานะความปลอดภัย Runtime Tamper Check', en: 'Check Runtime Sandbox Tamper Verification' },

  // Governance & Security
  'gov.title': { th: 'ความปลอดภัยและการตรวจสอบความถูกต้อง', en: 'Governance, Security & Integrity' },
  'gov.tamper_title': { th: 'ตรวจสอบความสมบูรณ์ของ Sandbox', en: 'Sandbox Runtime Tamper Verification' },
  'gov.tamper_desc': { th: 'รันการตรวจสอบภายใน /workspace sandbox เพื่อเทียบแฮช SHA-256 กับค่าตั้งต้น ป้องกัน Path Traversal', en: 'Executes isolated no-op script inside /workspace sandbox, comparing SHA-256 against Genesis State.' },
  'gov.btn_run_tamper': { th: 'รันการตรวจสอบ Sandbox', en: 'Run Sandbox Tamper Check' },
  'gov.tamper_free': { th: 'สภาพแวดล้อมปลอดภัย ไม่พบการดัดแปลง', en: 'Environment Verified Untampered' },
  'gov.tamper_detected': { th: 'ตรวจพบความผิดปกติใน Sandbox', en: 'Sandbox Anomaly Detected' },
  'gov.genesis_hash': { th: 'Genesis State Hash', en: 'Genesis State Hash' },
  'gov.exec_hash': { th: 'Execution Hash', en: 'Execution Hash' },
  'gov.files_audited': { th: 'ไฟล์ใน Sandbox ที่ตรวจแล้ว', en: 'Audited Sandbox Files' },
  'gov.boundary_intact': { th: 'ขอบเขต Sandbox ปกติ', en: 'Sandbox Boundary Intact' },

  // Native Memory Controller
  'mem.title': { th: 'ระบบความจำระยะยาว (Native Episodic Memory)', en: 'Native Episodic Memory Controller' },
  'mem.desc': { th: 'จัดเก็บความจำข้ามเซสชัน และบันทึกการเปลี่ยนแปลงลง AuditLedger พร้อม SHA-256 Chain', en: 'Persists memories across sessions. All operations are audited in SHA-256 ledger.' },
  'mem.store_key': { th: 'คีย์ความจำ (Key)', en: 'Memory Key' },
  'mem.store_value': { th: 'ข้อมูลความจำ (Value)', en: 'Memory Content' },
  'mem.category': { th: 'หมวดหมู่', en: 'Category' },
  'mem.save_btn': { th: 'บันทึกลงความจำถาวร', en: 'Store In Memory' },
  'mem.total_items': { th: 'จำนวนความจำที่บันทึก', en: 'Total Memory Items' },
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
    return 'th';
  });

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
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

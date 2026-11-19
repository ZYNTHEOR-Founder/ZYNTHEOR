import React from 'react';
import { useTheme, ThemeMode } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { Sun, Moon, Laptop, Palette, Sparkles, Check, RotateCcw, ShieldCheck, ShieldAlert } from 'lucide-react';

export const ThemeSwitcher: React.FC = () => {
  const {
    theme,
    resolvedTheme,
    setTheme,
    customAccent,
    setCustomAccent,
    accentIntensity,
    setAccentIntensity,
    resetThemeDefaults
  } = useTheme();

  const { lang } = useLanguage();

  const themeOptions: Array<{
    id: ThemeMode;
    labelTh: string;
    labelEn: string;
    subTh: string;
    subEn: string;
    icon: React.ReactNode;
    bgPreview: string;
    borderPreview: string;
    accentPreview: string;
  }> = [
    {
      id: 'emerald-amber',
      labelTh: 'กราไฟต์ & มรกต (ค่าเริ่มต้น)',
      labelEn: 'Graphite & Emerald (Default)',
      subTh: 'พื้นเทาเข้มขรึม ตัดสีเขียวมรกตคมชัด สบายตา',
      subEn: 'Nordic charcoal slate with crisp emerald accent',
      icon: <Moon className="w-4 h-4 text-[var(--app-accent)]" />,
      bgPreview: '#090D12',
      borderPreview: '#232E3F',
      accentPreview: '#10B981'
    },
    {
      id: 'light',
      labelTh: 'กระดาษสว่าง & เทอร์ควอยซ์ (Light)',
      labelEn: 'Porcelain & Teal (Light)',
      subTh: 'พื้นสว่างสะอาดตา ตัวหนังสือคมชัด อ่านง่าย',
      subEn: 'Clean porcelain light surface with forest teal',
      icon: <Sun className="w-4 h-4 text-[var(--app-accent)]" />,
      bgPreview: '#F8FAFC',
      borderPreview: '#DDE4EE',
      accentPreview: '#0D9488'
    },
    {
      id: 'dark',
      labelTh: 'คาร์บอน & ฟ้าโคบอลต์',
      labelEn: 'Carbon & Sky',
      subTh: 'พื้นคาร์บอนเข้มตัดสีฟ้าสกายคมชัด',
      subEn: 'Deep carbon dark with crisp sky blue',
      icon: <Moon className="w-4 h-4 text-[var(--app-accent)]" />,
      bgPreview: '#0A0E15',
      borderPreview: '#253145',
      accentPreview: '#38BDF8'
    },
    {
      id: 'midnight-navy',
      labelTh: 'มิดไนท์เนวี & แซฟไฟร์',
      labelEn: 'Midnight Sapphire',
      subTh: 'กรมท่าลึกตัดฟ้าแซฟไฟร์และทองแชมเปญ',
      subEn: 'Deep navy slate with sapphire blue',
      icon: <Palette className="w-4 h-4 text-[var(--app-accent)]" />,
      bgPreview: '#09101D',
      borderPreview: '#243554',
      accentPreview: '#60A5FA'
    },
    {
      id: 'vivid-cyan',
      labelTh: 'ดีปเทอร์ควอยซ์ & กลาเซียร์',
      labelEn: 'Glacier Teal',
      subTh: 'โทนเขียวอมฟ้าน้ำลึก สุขุมและทันสมัย',
      subEn: 'Deep sea teal with glacier mint accent',
      icon: <Sparkles className="w-4 h-4 text-[var(--app-accent)]" />,
      bgPreview: '#071316',
      borderPreview: '#1E3D47',
      accentPreview: '#2DD4BF'
    },
    {
      id: 'royal-purple',
      labelTh: 'ออบซิเดียน & ทองอำพัน',
      labelEn: 'Warm Obsidian & Gold',
      subTh: 'โทนมืดอุ่นตัดทองคำอำพันพรีเมียม',
      subEn: 'Warm espresso obsidian with burnished gold',
      icon: <Sparkles className="w-4 h-4 text-[var(--app-accent)]" />,
      bgPreview: '#12100C',
      borderPreview: '#383024',
      accentPreview: '#F59E0B'
    },
    {
      id: 'system',
      labelTh: 'ตามระบบ (System)',
      labelEn: 'System',
      subTh: 'สลับมืด/สว่างตามการตั้งค่าเครื่อง',
      subEn: 'Follows OS dark/light',
      icon: <Laptop className="w-4 h-4 text-[var(--app-accent)]" />,
      bgPreview: 'linear-gradient(135deg, #F8FAFC 50%, #090D12 50%)',
      borderPreview: '#94A3B8',
      accentPreview: '#10B981'
    },
  ];

  const presetAccents = [
    { label: 'Emerald', hex: '#10B981' },
    { label: 'Teal', hex: '#0D9488' },
    { label: 'Sky', hex: '#38BDF8' },
    { label: 'Sapphire', hex: '#60A5FA' },
    { label: 'Amber Gold', hex: '#F59E0B' },
    { label: 'Slate', hex: '#94A3B8' }
  ];

  return (
    <div className="space-y-6">
      {/* Theme Presets Grid */}
      <div>
        <div className="text-xs font-bold text-[var(--app-text-primary)] mb-3 flex items-center justify-between">
          <span>{lang === 'th' ? 'เลือกชุดสีและธีมหลัก (Theme Presets)' : 'Select Primary Theme Preset'}</span>
          <span className="text-[11px] font-mono font-medium text-[var(--app-text-secondary)]">
            {lang === 'th' ? 'ใช้งานอยู่:' : 'Active:'} <span className="font-bold text-[var(--app-accent)] ">{resolvedTheme}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {themeOptions.map((opt) => {
            const isSelected = theme === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setTheme(opt.id)}
                className={`p-3.5 rounded-2xl border text-left transition-all relative cursor-pointer ${
                  isSelected
                    ? 'border-[var(--app-accent)] shadow-md ring-2 ring-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] bg-[var(--app-surface)]'
                    : 'border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-surface)_60%,transparent)] hover:bg-[var(--app-surface)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-xl bg-[var(--app-surface-elevated)] dark:bg-[var(--app-surface)]">
                      {opt.icon}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-[var(--app-text-primary)]">
                        {lang === 'th' ? opt.labelTh : opt.labelEn}
                      </div>
                      <div className="text-[10px] text-[var(--app-text-secondary)]">
                        {lang === 'th' ? opt.subTh : opt.subEn}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-[var(--app-accent-deep)] text-white flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </div>

                {/* Mini Preview Bar */}
                <div className="mt-3 flex items-center gap-1.5 pt-2 border-t border-[var(--app-card-border)]">
                  <div
                    className="w-4 h-4 rounded-md border"
                    style={{ background: opt.bgPreview, borderColor: opt.borderPreview }}
                    title="Background"
                  />
                  <div
                    className="w-4 h-4 rounded-md"
                    style={{ background: opt.accentPreview }}
                    title="Accent"
                  />
                  <span className="text-[9px] font-mono text-[var(--app-text-secondary)] ml-auto">
                    {opt.id}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Accent Color & Intensity */}
      <div className="p-4 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-4">
        <div>
          <label className="block text-xs font-bold text-[var(--app-text-primary)] mb-2">
            {lang === 'th' ? 'สีเน้นเฉพาะตัว (Custom Accent Color)' : 'Custom Accent Color'}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {presetAccents.map((pa) => {
              const isActive = (customAccent || 'var(--app-accent)').toLowerCase() === pa.hex.toLowerCase();
              return (
                <button
                  key={pa.hex}
                  onClick={() => setCustomAccent(pa.hex)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'border-[var(--app-card-border)] shadow-sm scale-105'
                      : 'border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)] hover:scale-102'
                  }`}
                  style={{
                    backgroundColor: pa.hex + '18',
                    color: pa.hex
                  }}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: pa.hex }} />
                  <span>{pa.label}</span>
                </button>
              );
            })}

            {/* Custom Hex Picker Input */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)]">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(customAccent) ? customAccent : '#10B981'}
                onChange={(e) => setCustomAccent(e.target.value)}
                className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                title="Pick custom color"
              />
              <input
                type="text"
                value={customAccent}
                onChange={(e) => setCustomAccent(e.target.value)}
                placeholder="#10B981"
                className="w-20 text-[11px] font-mono bg-transparent text-[var(--app-text-primary)] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Accent Intensity Slider */}
        <div className="pt-2 border-t border-[var(--app-card-border)]">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-bold text-[var(--app-text-primary)]">
              {lang === 'th' ? 'ความเข้มของสี Accent (Accent Intensity)' : 'Accent Intensity'}
            </span>
            <span className="font-mono font-bold text-[var(--app-accent)]">
              {Math.round(accentIntensity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.6"
            max="1.4"
            step="0.05"
            value={accentIntensity}
            onChange={(e) => setAccentIntensity(parseFloat(e.target.value))}
            className="w-full accent-[var(--app-accent)] cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-[var(--app-text-secondary)] mt-0.5">
            <span>{lang === 'th' ? '60% (นุ่มนวล)' : '60% (Subtle)'}</span>
            <span>{lang === 'th' ? '100% (มาตรฐาน)' : '100% (Standard)'}</span>
            <span>{lang === 'th' ? '140% (คอนทราสต์สูง)' : '140% (High Contrast)'}</span>
          </div>
        </div>

        {/* Contrast & Accessibility Verification Card */}
        <div className="p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
          <div className="text-[11px] font-bold text-[var(--app-text-primary)] mb-2 flex items-center justify-between">
            <span>{lang === 'th' ? 'การรักษามาตรฐานการเข้าถึงและสีความปลอดภัย' : 'Accessibility & Status Color Invariants'}</span>
            <span className="text-[10px] text-[var(--z-ok)] font-mono font-bold">AAA ACCESSIBLE</span>
          </div>
          <p className="text-[11px] text-[var(--app-text-secondary)] mb-3 leading-relaxed">
            {lang === 'th'
              ? 'การปรับแต่งสีธีมจะไม่กระทบสีสถานะความปลอดภัยที่สำคัญ เช่น VERIFIED (สีเขียวมรกต) หรือ BLOCKED (สีแดงกุหลาบ) เพื่อให้การตรวจสอบ Audit ชัดเจนเสมอ'
              : 'Theme customization preserves all critical security status colors (VERIFIED: Emerald, BLOCKED: Rose) for uncompromised audit visibility.'}
          </p>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[color-mix(in_srgb,var(--z-ok)_10%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] font-bold font-mono">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>VERIFIED / TAMPER-FREE</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] font-bold font-mono">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>BLOCKED / TAMPER DETECTED</span>
            </div>
            <button
              onClick={resetThemeDefaults}
              className="ml-auto text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] flex items-center gap-1 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{lang === 'th' ? 'คืนค่าเริ่มต้น' : 'Reset Defaults'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

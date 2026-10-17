import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell
} from 'recharts';

function CustomTooltip({ active, payload, label, isLight, dailyGoal }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  const isGoalMet = data.xp >= dailyGoal;

  return (
    <div
      style={{
        background: isLight ? '#ffffff' : '#0f121d',
        border: `1px solid ${isLight ? 'rgba(0,0,0,0.1)' : 'rgba(124,92,255,0.3)'}`,
        borderRadius: '14px',
        padding: '12px 16px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
        color: isLight ? '#0f172a' : '#f8fafc',
        minWidth: '180px',
        fontSize: '0.86rem',
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '6px', color: '#7c5cff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{data.fullDay || data.day}</span>
        <span style={{ fontSize: '0.78rem', color: isLight ? '#64748b' : '#94a3b8' }}>{data.date}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0' }}>
        <span style={{ color: isLight ? '#475569' : '#cbd5e1' }}>To'plangan XP:</span>
        <b style={{ color: '#00d4ff', fontSize: '1.05rem' }}>+{data.xp} XP</b>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0' }}>
        <span style={{ color: isLight ? '#475569' : '#cbd5e1' }}>Kunlik maqsad:</span>
        <span>{dailyGoal} XP</span>
      </div>
      <div
        style={{
          marginTop: '8px',
          paddingTop: '6px',
          borderTop: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '0.8rem',
          color: isGoalMet ? '#10b981' : '#f59e0b',
          fontWeight: 600,
        }}
      >
        <span>{isGoalMet ? '✓ Maqsad bajarildi' : '⚠️ Bajarilmadi'}</span>
      </div>
    </div>
  );
}

export function LanguageProficiencyProgress({ initialData }) {
  const [data, setData] = useState(initialData || null);
  const [chartType, setChartType] = useState('area'); // 'area' | 'bar'
  const [isLight, setIsLight] = useState(false);
  const [loading, setLoading] = useState(!initialData);

  // Detect and sync with website theme
  useEffect(() => {
    const checkTheme = () => {
      const theme = document.documentElement.dataset.theme || localStorage.getItem('lf_theme');
      setIsLight(theme === 'light');
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Fetch fresh weekly proficiency insights from API
  useEffect(() => {
    async function fetchInsights() {
      try {
        const res = await fetch('/api/progress/proficiency', { credentials: 'same-origin' });
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (err) {
        console.error('Failed to load proficiency data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchInsights();
  }, []);

  if (loading && !data) {
    return (
      <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
        Til o'zlashtirish statistikasi yuklanmoqda...
      </div>
    );
  }

  const weeklyData = data?.weekly || [];
  const summary = data?.summary || {};
  const user = data?.user || {};
  const dailyGoal = user.dailyGoal || 20;

  const totalWeeklyXp = summary.totalWeeklyXp || weeklyData.reduce((acc, d) => acc + (d.xp || 0), 0);
  const avgDailyXp = summary.avgDailyXp || Math.round(totalWeeklyXp / (weeklyData.length || 7));
  const activeDays = summary.activeDays || weeklyData.filter((d) => d.xp > 0).length;
  const growth = summary.growthPercent ?? 0;
  const bestDay = weeklyData.reduce((max, d) => (d.xp > (max?.xp || 0) ? d : max), weeklyData[0]);

  const levelInfo = summary.currentProficiency || {
    level: user.level || 'B1',
    name: 'Mustaqil o\'rganuvchi',
    nextLevel: 'B2',
    progressPct: summary.percentToNextLevel || 68,
    remainingXp: summary.xpToNextLevel || 95,
  };

  const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.07)';
  const textColor = isLight ? '#64748b' : '#94a3b8';

  return (
    <div className="card proficiency-progress-card" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.6rem' }}>📈</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.3px' }}>
                Language Proficiency Progress
              </h2>
              <div style={{ fontSize: '0.84rem', color: 'var(--muted)', marginTop: '2px' }}>
                Haftalik XP o'sishi va til o'zlashtirish dinamikasi
              </div>
            </div>
          </div>
        </div>

        {/* View toggles & CEFR level badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'inline-flex', background: isLight ? '#f1f5f9' : 'rgba(255,255,255,0.06)', borderRadius: '10px', padding: '3px', border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'}` }}>
            <button
              type="button"
              onClick={() => setChartType('area')}
              style={{
                border: 'none',
                background: chartType === 'area' ? 'var(--brand)' : 'transparent',
                color: chartType === 'area' ? '#fff' : 'var(--muted)',
                padding: '4px 10px',
                borderRadius: '7px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              🌊 To'lqin
            </button>
            <button
              type="button"
              onClick={() => setChartType('bar')}
              style={{
                border: 'none',
                background: chartType === 'bar' ? 'var(--brand)' : 'transparent',
                color: chartType === 'bar' ? '#fff' : 'var(--muted)',
                padding: '4px 10px',
                borderRadius: '7px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              📊 Ustunlar
            </button>
          </div>

          <span
            style={{
              padding: '5px 12px',
              borderRadius: '9999px',
              fontSize: '0.82rem',
              fontWeight: 800,
              background: 'linear-gradient(135deg, rgba(124,92,255,0.2), rgba(0,212,255,0.15))',
              border: '1px solid rgba(124,92,255,0.4)',
              color: '#00d4ff',
            }}
          >
            CEFR {levelInfo.level}
          </span>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
          marginBottom: '22px',
        }}
      >
        {/* Total XP */}
        <div className="stat-tile" style={{ padding: '12px 14px', textAlign: 'left', borderRadius: '14px' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Haftalik Jami
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '4px 0 2px' }}>
            <b style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)' }}>{totalWeeklyXp}</b>
            <span style={{ fontSize: '0.85rem', color: 'var(--brand)', fontWeight: 700 }}>XP</span>
          </div>
          <div style={{ fontSize: '0.74rem', color: growth >= 0 ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
            {growth >= 0 ? `↑ +${growth}%` : `↓ ${growth}%`} o'tgan haftaga
          </div>
        </div>

        {/* Daily Average */}
        <div className="stat-tile" style={{ padding: '12px 14px', textAlign: 'left', borderRadius: '14px' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Kunlik O'rtacha
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '4px 0 2px' }}>
            <b style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)' }}>{avgDailyXp}</b>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>XP/kun</span>
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
            Maqsad: {dailyGoal} XP
          </div>
        </div>

        {/* Active Days */}
        <div className="stat-tile" style={{ padding: '12px 14px', textAlign: 'left', borderRadius: '14px' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Faol Kunlar
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '4px 0 2px' }}>
            <b style={{ fontSize: '1.4rem', fontWeight: 800, color: '#00d4ff' }}>{activeDays}</b>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>/ 7 kun</span>
          </div>
          <div style={{ fontSize: '0.74rem', color: '#10b981', fontWeight: 600 }}>
            🔥 {user.streak || 0} kunlik seriya
          </div>
        </div>

        {/* Level Progression */}
        <div className="stat-tile" style={{ padding: '12px 14px', textAlign: 'left', borderRadius: '14px' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Keyingi Pog'ona
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '4px 0 2px' }}>
            <b style={{ fontSize: '1.3rem', fontWeight: 800, color: '#7c5cff' }}>{levelInfo.nextLevel || 'C1'}</b>
            <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>({levelInfo.progressPct}%)</span>
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
            yana {levelInfo.remainingXp} XP qoldi
          </div>
        </div>
      </div>

      {/* Main Recharts Visualization */}
      <div style={{ width: '100%', height: '260px', position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'area' ? (
            <AreaChart data={weeklyData} margin={{ top: 15, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="proficiencyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c5cff" stopOpacity={0.65} />
                  <stop offset="95%" stopColor="#00d4ff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
              <XAxis dataKey="day" stroke={textColor} fontSize={12} tickLine={false} axisLine={{ stroke: gridColor }} />
              <YAxis stroke={textColor} fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip isLight={isLight} dailyGoal={dailyGoal} />} />
              <ReferenceLine
                y={dailyGoal}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{
                  value: `🎯 Maqsad (${dailyGoal} XP)`,
                  position: 'insideTopRight',
                  fill: '#f59e0b',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
              <Area
                type="monotone"
                dataKey="xp"
                stroke="#7c5cff"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#proficiencyGrad)"
                dot={{ r: 4, fill: '#00d4ff', strokeWidth: 2, stroke: '#7c5cff' }}
                activeDot={{ r: 7, fill: '#00d4ff', strokeWidth: 3, stroke: '#ffffff' }}
              />
            </AreaChart>
          ) : (
            <BarChart data={weeklyData} margin={{ top: 15, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
              <XAxis dataKey="day" stroke={textColor} fontSize={12} tickLine={false} axisLine={{ stroke: gridColor }} />
              <YAxis stroke={textColor} fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip isLight={isLight} dailyGoal={dailyGoal} />} />
              <ReferenceLine
                y={dailyGoal}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{
                  value: `🎯 Maqsad (${dailyGoal} XP)`,
                  position: 'insideTopRight',
                  fill: '#f59e0b',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
              <Bar dataKey="xp" radius={[8, 8, 0, 0]}>
                {weeklyData.map((entry, index) => {
                  const isGoal = entry.xp >= dailyGoal;
                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={isGoal ? 'url(#barGradientGoal)' : 'url(#barGradientNorm)'}
                    />
                  );
                })}
              </Bar>
              <defs>
                <linearGradient id="barGradientGoal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00d4ff" />
                  <stop offset="100%" stopColor="#7c5cff" />
                </linearGradient>
                <linearGradient id="barGradientNorm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="#7c5cff" stopOpacity={0.4} />
                </linearGradient>
              </defs>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Actionable Learning Insights Strip */}
      <div
        style={{
          marginTop: '18px',
          padding: '12px 16px',
          borderRadius: '12px',
          background: isLight ? 'rgba(99,102,241,0.06)' : 'rgba(124,92,255,0.08)',
          border: `1px solid ${isLight ? 'rgba(99,102,241,0.15)' : 'rgba(124,92,255,0.2)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          fontSize: '0.84rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>💡</span>
          <span>
            {bestDay && bestDay.xp > 0 ? (
              <>
                Eng samarali kun: <b>{bestDay.fullDay || bestDay.day} (+{bestDay.xp} XP)</b>. {levelInfo.nextLevel} darajaga erishish uchun haftasiga yana {Math.max(10, levelInfo.remainingXp)} XP to'plang.
              </>
            ) : (
              <>
                Bugungi darslarni boshlang va haftalik o'sish grafigingizda birinchi natijani qayd eting!
              </>
            )}
          </span>
        </div>
        <a
          href="#/practice"
          className="btn btn-ghost btn-sm"
          style={{ textDecoration: 'none', whiteSpace: 'nowrap', fontSize: '0.78rem' }}
        >
          Mashqlarni boshlash →
        </a>
      </div>
    </div>
  );
}

// Global browser mounting helper
window.mountLanguageProficiencyProgress = function (container, initialData) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<LanguageProficiencyProgress initialData={initialData} />);
  return root;
};

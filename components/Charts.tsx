import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { EmotionDataPoint } from '../types';

interface TimelineProps {
  data: EmotionDataPoint[];
}

export const EmotionTimeline: React.FC<TimelineProps> = ({ data }) => {
  return (
    <div className="w-full h-full flex flex-col">
      <h3 className="text-xs text-slate-400 mb-2 font-mono uppercase flex-none">Emotional Intensity (Baseline Deviation)</h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" hide />
            <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={10} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
              itemStyle={{ color: '#38bdf8' }}
            />
            <Line 
              type="monotone" 
              dataKey="intensity" 
              stroke="#38bdf8" 
              strokeWidth={2} 
              dot={false} 
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const ActionUnitGraph: React.FC<{ activeAus: string[] }> = ({ activeAus }) => {
    // Pre-define common AUs for the chart structure
    const allAUs = [
        { name: 'AU1 (Inner Brow)', code: 'AU1' },
        { name: 'AU2 (Outer Brow)', code: 'AU2' },
        { name: 'AU4 (Brow Lower)', code: 'AU4' },
        { name: 'AU6 (Cheek Raise)', code: 'AU6' },
        { name: 'AU9 (Nose Wrinkle)', code: 'AU9' },
        { name: 'AU12 (Lip Corner)', code: 'AU12' },
        { name: 'AU15 (Lip Corner)', code: 'AU15' },
        { name: 'AU20 (Lip Stretch)', code: 'AU20' },
    ];

    const data = allAUs.map(au => ({
        name: au.name,
        value: activeAus.includes(au.code) ? 100 : 5,
        code: au.code
    }));

    return (
        <div className="w-full h-full flex flex-col">
            <h3 className="text-xs text-slate-400 mb-2 font-mono uppercase flex-none">Real-time FACS Activation</h3>
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                        <XAxis type="number" domain={[0, 100]} hide />
                        <YAxis 
                          dataKey="code" 
                          type="category" 
                          width={50} 
                          stroke="#94a3b8" 
                          fontSize={10} 
                          tick={{fill: '#94a3b8'}}
                        />
                        <Tooltip 
                            cursor={{fill: '#1e293b'}}
                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={12}>
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.value > 50 ? '#10b981' : '#334155'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
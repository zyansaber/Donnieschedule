import React, { useState, useEffect } from 'react';
import { fetchScheduleData } from './src/data/scheduleData.js';

const DebugFirebaseData = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        console.log('🔍 正在从Firebase获取真实数据...');
        const firebaseData = await fetchScheduleData();
        console.log('📊 Firebase数据:', firebaseData);
        setData(firebaseData);
        
        // 分析Estimate Semi Received Date
        const estimateDates = {};
        let totalWithEstimate = 0;
        let totalWithoutEstimate = 0;
        
        firebaseData.forEach((item, index) => {
          const estimateDate = item["Estimate Semi Received Date"];
          
          if (estimateDate && estimateDate.trim() !== '') {
            totalWithEstimate++;
            const dateString = estimateDate.trim();
            console.log(`${index + 1}. Chassis: ${item.Chassis || '未知'} | Estimate Date: ${dateString}`);
            
            // 解析DD/MM/YYYY格式
            const parts = dateString.split('/');
            if (parts.length === 3) {
              const day = parts[0].padStart(2, '0');
              const month = parts[1].padStart(2, '0');
              const year = parts[2];
              const standardDate = `${year}-${month}-${day}`;
              
              if (!estimateDates[standardDate]) {
                estimateDates[standardDate] = {
                  count: 0,
                  chassisNumbers: []
                };
              }
              
              estimateDates[standardDate].count++;
              estimateDates[standardDate].chassisNumbers.push(item.Chassis || '未知');
            }
          } else {
            totalWithoutEstimate++;
          }
        });
        
        setAnalysis({
          totalRecords: firebaseData.length,
          totalWithEstimate,
          totalWithoutEstimate,
          estimateDates: Object.keys(estimateDates).sort().map(date => ({
            date,
            count: estimateDates[date].count,
            chassisNumbers: estimateDates[date].chassisNumbers
          }))
        });
        
      } catch (error) {
        console.error('❌ 获取Firebase数据失败:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, []);

  if (loading) {
    return <div>正在加载Firebase数据...</div>;
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h2>🔥 Firebase 数据分析报告</h2>
      
      {analysis && (
        <div>
          <h3>📊 统计汇总</h3>
          <p>总记录数: {analysis.totalRecords}</p>
          <p>有Estimate Semi Received Date: {analysis.totalWithEstimate}</p>
          <p>无Estimate Semi Received Date: {analysis.totalWithoutEstimate}</p>
          
          <h3>📅 Estimate Semi Received Date 按日期统计</h3>
          {analysis.estimateDates.length === 0 ? (
            <p style={{ color: 'red' }}>⚠️ 没有找到任何有效的Estimate Semi Received Date数据</p>
          ) : (
            analysis.estimateDates.map(({ date, count, chassisNumbers }) => (
              <div key={date} style={{ marginBottom: '10px', border: '1px solid #ccc', padding: '10px' }}>
                <strong>📅 {date}: {count}个单位</strong>
                <br />
                📦 Chassis: {chassisNumbers.join(', ')}
              </div>
            ))
          )}
          
          <h3>🔧 图表应显示的柱状图</h3>
          {analysis.estimateDates.map(({ date, count }) => (
            <p key={date}>📊 {date}: 柱子高度 = {count}</p>
          ))}
        </div>
      )}
      
      <h3>🗃️ 原始数据 (前10条)</h3>
      <pre style={{ background: '#f5f5f5', padding: '10px', overflow: 'auto', maxHeight: '400px' }}>
        {JSON.stringify(data.slice(0, 10), null, 2)}
      </pre>
    </div>
  );
};

export default DebugFirebaseData;
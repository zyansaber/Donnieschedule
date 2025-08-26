// Temporary script to analyze Estimate Semi Received Date data
import { fetchScheduleData } from './src/data/scheduleData.js';

async function analyzeEstimateDates() {
  try {
    console.log('🔍 正在获取数据...\n');
    const data = await fetchScheduleData();
    
    console.log(`📊 总数据条数: ${data.length}\n`);
    
    // 统计所有的Estimate Semi Received Date
    const estimateDates = {};
    let totalWithEstimateDate = 0;
    let totalWithoutEstimateDate = 0;
    
    console.log('📋 所有记录的Estimate Semi Received Date分析:\n');
    
    data.forEach((item, index) => {
      const estimateDate = item["Estimate Semi Received Date"];
      
      if (estimateDate && estimateDate.trim() !== '') {
        totalWithEstimateDate++;
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
              originalDates: [],
              chassisNumbers: []
            };
          }
          
          estimateDates[standardDate].count++;
          estimateDates[standardDate].originalDates.push(dateString);
          estimateDates[standardDate].chassisNumbers.push(item.Chassis || '未知');
        }
      } else {
        totalWithoutEstimateDate++;
      }
    });
    
    console.log(`\n📈 统计汇总:`);
    console.log(`- 有Estimate Semi Received Date的记录: ${totalWithEstimateDate}`);
    console.log(`- 没有Estimate Semi Received Date的记录: ${totalWithoutEstimateDate}`);
    
    console.log(`\n📅 按日期统计的Estimate Semi Received Date:`);
    console.log('================================');
    
    // 按日期排序并显示统计
    const sortedDates = Object.keys(estimateDates).sort();
    
    if (sortedDates.length === 0) {
      console.log('⚠️  没有找到任何有效的Estimate Semi Received Date数据');
    } else {
      sortedDates.forEach(date => {
        const dateInfo = estimateDates[date];
        console.log(`📊 ${date}: ${dateInfo.count}个 (原始格式: ${dateInfo.originalDates.join(', ')})`);
        console.log(`   Chassis: ${dateInfo.chassisNumbers.join(', ')}`);
        console.log('');
      });
    }
    
    console.log('\n🔧 图表应该显示的柱状图数据:');
    console.log('================================');
    sortedDates.forEach(date => {
      const count = estimateDates[date].count;
      console.log(`${date}: ${count}个柱子`);
    });
    
  } catch (error) {
    console.error('❌ 错误:', error);
  }
}

// 运行分析
analyzeEstimateDates();
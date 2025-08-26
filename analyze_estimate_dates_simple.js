// Simple analysis script using mock data
const mockScheduleData = [
  {
    id: "1001",
    "Forecast Production Date": "15/03/2025",
    "Request Delivery Date": "01/04/2025",
    "Shipment": "Ground",
    "Regent Production": "In Progress",
    "Model Year": "2025",
    "Chassis": "ABC123",
    "Model": "Premium XL",
    "Dealer": "AutoMax",
    "Customer": "John Smith",
    "Order Received Date": "15/01/2025",
    "Order Sent to Longtree": "20/01/2025",
    "Plans Sent to Dealer": "25/01/2025",
    "Signed Plans Received": "01/02/2025",
    "Purchase Order Sent": "05/02/2025",
    "Estimate Semi Received Date": "26/08/2025"  // 添加测试数据
  },
  {
    id: "1002",
    "Forecast Production Date": "10/04/2025",
    "Request Delivery Date": "25/04/2025",
    "Shipment": "Express",
    "Regent Production": "Queued",
    "Model Year": "2025",
    "Chassis": "DEF456",
    "Model": "Deluxe GT",
    "Dealer": "CarWorld",
    "Customer": "Jane Doe",
    "Order Received Date": "01/02/2025",
    "Order Sent to Longtree": "05/02/2025",
    "Plans Sent to Dealer": "10/02/2025",
    "Signed Plans Received": "15/02/2025",
    "Purchase Order Sent": "20/02/2025",
    "Estimate Semi Received Date": "15/09/2025"  // 添加测试数据
  },
  {
    id: "1003",
    "Forecast Production Date": "20/05/2025",
    "Request Delivery Date": "05/06/2025",
    "Shipment": "Ground",
    "Regent Production": "Planning",
    "Model Year": "2025",
    "Chassis": "GHI789",
    "Model": "Standard SE",
    "Dealer": "MotorHub",
    "Customer": "Robert Johnson",
    "Order Received Date": "01/03/2025",
    "Order Sent to Longtree": "05/03/2025",
    "Plans Sent to Dealer": "10/03/2025",
    "Signed Plans Received": "15/03/2025",
    "Purchase Order Sent": "20/03/2025",
    "Estimate Semi Received Date": "26/08/2025"  // 相同日期测试
  },
  {
    id: "1004",
    "Forecast Production Date": "15/06/2025",
    "Request Delivery Date": "01/07/2025",
    "Shipment": "Express",
    "Regent Production": "finished",
    "Model Year": "2026",
    "Chassis": "JKL012",
    "Model": "Premium XL",
    "Dealer": "AutoMax",
    "Customer": "Emily Wilson",
    "Order Received Date": "01/04/2025",
    "Order Sent to Longtree": "05/04/2025",
    "Plans Sent to Dealer": "10/04/2025",
    "Signed Plans Received": "15/04/2025",
    "Purchase Order Sent": "20/04/2025"
    // 没有Estimate Semi Received Date
  },
  {
    id: "1005",
    "Forecast Production Date": "10/07/2025",
    "Request Delivery Date": "25/07/2025",
    "Shipment": "Ground",
    "Regent Production": "In Progress-Perth",
    "Model Year": "2026",
    "Chassis": "MNO345",
    "Model": "Deluxe GT",
    "Dealer": "CarWorld",
    "Customer": "Michael Brown",
    "Order Received Date": "01/05/2025",
    "Order Sent to Longtree": "05/05/2025",
    "Plans Sent to Dealer": "10/05/2025",
    "Signed Plans Received": "15/05/2025",
    "Purchase Order Sent": "20/05/2025",
    "Estimate Semi Received Date": "10/10/2025"  // 添加测试数据
  }
];

function analyzeEstimateDates() {
  console.log('🔍 分析Mock数据中的Estimate Semi Received Date...\n');
  
  const data = mockScheduleData;
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
      console.log(`${index + 1}. Chassis: ${item.Chassis || '未知'} | Estimate Date: [无数据]`);
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
      console.log(`📊 ${date}: ${dateInfo.count}个单位 (原始格式: ${dateInfo.originalDates.join(', ')})`);
      console.log(`   📦 Chassis: ${dateInfo.chassisNumbers.join(', ')}`);
      console.log('');
    });
  }
  
  console.log('\n🔧 图表中柱状图应该显示的数据:');
  console.log('================================');
  if (sortedDates.length > 0) {
    sortedDates.forEach(date => {
      const count = estimateDates[date].count;
      console.log(`📅 ${date}: 柱子高度 = ${count}`);
    });
  } else {
    console.log('⚠️  没有数据，所有柱子高度应该为0');
  }
  
  console.log('\n💡 总结:');
  console.log('- 只有包含"Estimate Semi Received Date"字段且不为空的记录才应该在柱状图中显示');
  console.log('- 相同日期的记录会累加在同一个柱子中');
  console.log('- 没有估计日期的记录不应该影响图表显示');
}

// 运行分析
analyzeEstimateDates();
import { getApps, getApp, initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, get } from "firebase/database";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBcczqGj5X1_w9aCX1lOK4-kgz49Oi03Bg",
  authDomain: "scheduling-dd672.firebaseapp.com",
  databaseURL: "https://scheduling-dd672-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "scheduling-dd672",
  storageBucket: "scheduling-dd672.firebasestorage.app",
  messagingSenderId: "432092773012",
  appId: "1:432092773012:web:ebc7203ea570b0da2ad281"
};

// Initialize Firebase with singleton pattern
let app;
let database;

try {
  // Check if Firebase app is already initialized
  if (getApps().length === 0) {
    // Initialize new Firebase app
    app = initializeApp(firebaseConfig);
    console.log("Firebase initialized successfully in scheduleData.js");
  } else {
    // Use existing Firebase app
    app = getApp();
    console.log("Using existing Firebase app in scheduleData.js");
  }
  
  // Get Database instance
  database = getDatabase(app);
} catch (error) {
  console.error("Error initializing Firebase in scheduleData.js:", error);
}

// Function to fetch schedule data from Firebase
export const fetchScheduleData = async () => {
  try {
    const scheduleRef = ref(database, 'schedule');
    return new Promise((resolve, reject) => {
      onValue(scheduleRef, 
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            // Convert object to array and format dates correctly
            const dataArray = Object.entries(data).map(([key, value]) => {
              // Parse dates from DD/MM/YYYY format to YYYY-MM-DD for proper sorting
              const formattedItem = {...value};
              
              // No need to include key as ID
              return formattedItem;
            });
            
            resolve(dataArray);
          } else {
            console.log("No data available in Firebase");
            resolve([]);
          }
        }, 
        (error) => {
          console.error("Error fetching schedule data:", error);
          reject(error);
        }
      );
    });
  } catch (error) {
    console.error("Error setting up schedule data listener:", error);
    throw error;
  }
};

// Function to save dealer colors to Firebase
export const saveDealerColors = async (colors) => {
  try {
    const dealerColorsRef = ref(database, 'dealerColors');
    await set(dealerColorsRef, colors);
    return true;
  } catch (error) {
    console.error("Error saving dealer colors:", error);
    throw error;
  }
};

// Function to fetch dealer colors from Firebase
export const fetchDealerColors = async () => {
  try {
    const dealerColorsRef = ref(database, 'dealerColors');
    return new Promise((resolve, reject) => {
      get(dealerColorsRef).then((snapshot) => {
        if (snapshot.exists()) {
          resolve(snapshot.val());
        } else {
          console.log("No dealer colors available in Firebase");
          resolve({});
        }
      }).catch((error) => {
        console.error("Error fetching dealer colors:", error);
        reject(error);
      });
    });
  } catch (error) {
    console.error("Error setting up dealer colors fetch:", error);
    throw error;
  }
};

// Function to save dealer notes to Firebase
export const saveDealerNotes = async (notes) => {
  try {
    const dealerNotesRef = ref(database, 'dealerNotes');
    await set(dealerNotesRef, notes);
    return true;
  } catch (error) {
    console.error("Error saving dealer notes:", error);
    throw error;
  }
};

// Function to fetch dealer notes from Firebase
export const fetchDealerNotes = async () => {
  try {
    const dealerNotesRef = ref(database, 'dealerNotes');
    return new Promise((resolve, reject) => {
      get(dealerNotesRef).then((snapshot) => {
        if (snapshot.exists()) {
          resolve(snapshot.val());
        } else {
          console.log("No dealer notes available in Firebase");
          resolve({});
        }
      }).catch((error) => {
        console.error("Error fetching dealer notes:", error);
        reject(error);
      });
    });
  } catch (error) {
    console.error("Error setting up dealer notes fetch:", error);
    throw error;
  }
};

// Function to fetch Calendar data from Firebase
export const fetchCalendarData = async () => {
  try {
    const calendarRef = ref(database, 'Calendar');
    return new Promise((resolve, reject) => {
      get(calendarRef).then((snapshot) => {
        if (snapshot.exists()) {
          resolve(snapshot.val());
        } else {
          console.log("No calendar data available in Firebase");
          resolve({});
        }
      }).catch((error) => {
        console.error("Error fetching calendar data:", error);
        reject(error);
      });
    });
  } catch (error) {
    console.error("Error setting up calendar data fetch:", error);
    throw error;
  }
};

// Mock data structure for development (will be replaced by Firebase data in production)
export const mockScheduleData = [
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
    "Purchase Order Sent": "05/02/2025"
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
    "Purchase Order Sent": "20/02/2025"
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
    "Purchase Order Sent": "20/03/2025"
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
    "Purchase Order Sent": "20/05/2025"
  }
];

// Mock dealer colors for development
export const mockDealerColors = {
  "AutoMax": "#e3f2fd",
  "CarWorld": "#f3e5f5",
  "MotorHub": "#e8f5e9",
  "VehiclePlus": "#fff8e1",
  "DriveTime": "#efebe9"
};

// Mock dealer notes for development
export const mockDealerNotes = {
  "AutoMax": {
    text: "Premium dealer with high sales volume.",
    class: "jv_dealer"
  },
  "CarWorld": {
    text: "Mid-tier dealer, good customer service.",
    class: "self_owned_dealer"
  },
  "MotorHub": {
    text: "New dealer, needs more support.",
    class: "external_dealer"
  },
  "VehiclePlus": {
    text: "International dealer, requires sea freight.",
    class: "external_dealer"
  },
  "DriveTime": {
    text: "Strategic partner, priority handling.",
    class: "jv_dealer"
  }
};

// Mock Calendar data for development
export const mockCalendarData = {
  "2025-01": 15,
  "2025-02": 18,
  "2025-03": 22,
  "2025-04": 20,
  "2025-05": 25,
  "2025-06": 19,
  "2025-07": 23,
  "2025-08": 21,
  "2025-09": 17,
  "2025-10": 24,
  "2025-11": 16,
  "2025-12": 20
};

// Get one year ago date in YYYY-MM format
const getOneYearAgoDate = () => {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  return `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, '0')}`;
};

// Production stage counts
export const getProductionStageCounts = (data) => {
  const stages = {};
  const seaFreightingStages = [];
  
  data.forEach(item => {
    if (item["Regent Production"]) {
      const stage = item["Regent Production"];
      
      // Skip "Finished" stage as requested
      if (stage.toLowerCase() === "finished") {
        return;
      }
      
      // Group stages with '-' as "Sea Freighting"
      if (stage.includes('-')) {
        seaFreightingStages.push(stage);
        if (!stages["Sea Freighting"]) {
          stages["Sea Freighting"] = 0;
        }
        stages["Sea Freighting"]++;
      } else {
        if (!stages[stage]) {
          stages[stage] = 0;
        }
        stages[stage]++;
      }
    }
  });
  
  return stages;
};

// Get production stages by dealer class
export const getProductionStagesByDealerClass = async (data) => {
  const classGroups = {};
  const dealerNotes = await fetchDealerNotes();
  
  // Prepare the class groups - updated class types according to requirements
  const classTypes = ['jv_dealer', 'self_owned_dealer', 'external_dealer'];
  classTypes.forEach(type => {
    classGroups[type] = {};
  });
  
  // Group data by dealer class and production stage
  data.forEach(item => {
    if (item["Regent Production"] && item["Dealer"]) {
      const stage = item["Regent Production"].toLowerCase();
      const dealer = item["Dealer"];
      const dealerClass = dealerNotes[dealer]?.class || 'external_dealer';
      
      // Skip "Finished" stage as requested
      if (stage === "finished") {
        return;
      }
      
      // Determine display stage name
      let displayStage = item["Regent Production"];
      if (displayStage.includes('-')) {
        displayStage = "Sea Freighting";
      }
      
      // Initialize if needed
      if (!classGroups[dealerClass][displayStage]) {
        classGroups[dealerClass][displayStage] = 0;
      }
      
      // Increment count
      classGroups[dealerClass][displayStage]++;
    }
  });
  
  // Format data for stacked bar chart
  const chartData = [];
  const allStages = new Set();
  
  // Collect all unique stages
  Object.values(classGroups).forEach(stageGroup => {
    Object.keys(stageGroup).forEach(stage => {
      allStages.add(stage);
    });
  });
  
  // Create data for each class
  classTypes.forEach(classType => {
    const classData = {
      class: getClassDisplayName(classType)
    };
    
    // Add count for each stage
    allStages.forEach(stage => {
      classData[stage] = classGroups[classType][stage] || 0;
    });
    
    chartData.push(classData);
  });
  
  return {
    chartData,
    stages: Array.from(allStages)
  };
};

// Helper function to get display name for dealer class
function getClassDisplayName(classType) {
  switch (classType) {
    case 'jv_dealer': return 'JV Dealer';
    case 'self_owned_dealer': return 'Self-owned Dealer';
    case 'external_dealer': return 'External Dealer';
    default: return classType;
  }
}

// Get forecast years distribution
export const getForecastYearCounts = (data) => {
  const years = {};
  
  data.forEach(item => {
    if (item && item["Forecast Production Date"] && item["Chassis"]) {
      // Extract year from date format DD/MM/YYYY
      const dateParts = item["Forecast Production Date"].split('/');
      let year;
      if (dateParts.length >= 3) {
        year = dateParts[2]; // YYYY from DD/MM/YYYY
        
        // Skip 2024 data as requested
        if (year === "2024") {
          return;
        }
      } else {
        // Handle other formats if any
        year = new Date().getFullYear().toString();
      }
      
      if (!years[year]) {
        years[year] = 0;
      }
      years[year]++;
    }
  });
  
  return years;
};

// Get monthly order received data for line chart (past year only)
export const getMonthlyOrderData = (data) => {
  const monthlyData = {};
  const oneYearAgoDate = getOneYearAgoDate();
  
  data.forEach(item => {
    if (item["Order Received Date"]) {
      // Convert DD/MM/YYYY to YYYY-MM format
      const dateParts = item["Order Received Date"].split('/');
      let yearMonth = "";
      
      if (dateParts.length >= 3) {
        const year = dateParts[2];
        const month = dateParts[1];
        yearMonth = `${year}-${month}`;
        
        // Only include data from the past year
        if (yearMonth < oneYearAgoDate) {
          return;
        }
      } else {
        // Fallback for other formats
        yearMonth = "Unknown";
      }
      
      if (!monthlyData[yearMonth]) {
        monthlyData[yearMonth] = 0;
      }
      monthlyData[yearMonth]++;
    }
  });
  
  // Convert to array format for charting
  return Object.entries(monthlyData)
    .filter(([date]) => date !== "Unknown")
    .map(([date, count]) => ({
      date,
      count
    })).sort((a, b) => a.date.localeCompare(b.date));
};

// Get monthly production data
export const getMonthlyProductionData = (data) => {
  const monthlyData = {};
  
  data.forEach(item => {
    if (item["Forecast Production Date"] && item["Chassis"]) {
      // Convert DD/MM/YYYY to YYYY-MM format
      const dateParts = item["Forecast Production Date"].split('/');
      let yearMonth = "";
      
      if (dateParts.length >= 3) {
        const year = dateParts[2];
        const month = dateParts[1];
        yearMonth = `${year}-${month}`;
      } else {
        // Fallback for other formats
        yearMonth = "Unknown";
      }
      
      if (!monthlyData[yearMonth]) {
        monthlyData[yearMonth] = 0;
      }
      monthlyData[yearMonth]++;
    }
  });
  
  // Convert to array format for charting
  return Object.entries(monthlyData)
    .filter(([date]) => date !== "Unknown")
    .map(([date, count]) => ({
      date,
      count
    })).sort((a, b) => a.date.localeCompare(b.date));
};

// Get unique dealer list
export const getUniqueDealers = (data) => {
  const dealers = new Set();
  data.forEach(item => {
    if (item["Dealer"]) {
      dealers.add(item["Dealer"]);
    }
  });
  return Array.from(dealers);
};

// Check if a date is within the next 20 weeks
export const isDateWithinNext20Weeks = (dateString) => {
  if (!dateString) return false;
  
  const parts = dateString.split('/');
  if (parts.length !== 3) return false;
  
  const [day, month, year] = parts;
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const twentyWeeksFromNow = new Date(today);
  twentyWeeksFromNow.setDate(today.getDate() + 20 * 7);
  
  return date >= today && date <= twentyWeeksFromNow;
};
// Fetch date tracking data from Firebase
export const fetchDateTrackData = async () => {
  try {
    const dateTrackRef = ref(database, 'datetrack');
    return new Promise((resolve, reject) => {
      get(dateTrackRef).then((snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          console.log("Date track data fetched:", data);
          resolve(data);
        } else {
          console.log("No date track data available in Firebase");
          resolve({});
        }
      }).catch((error) => {
        console.error("Error fetching date track data:", error);
        reject(error);
      });
    });
  } catch (error) {
    console.error("Error setting up date track data fetch:", error);
    throw error;
  }
};

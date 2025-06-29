// utils/sportDetection.js

export const detectSportFromQuestion = (question) => {
    const q = question.toLowerCase();
  
    const sportRules = [
      {
        sport: 'golf',
        triggers: ['golfer', 'golf', 'water hazard', 'penalty area', 'ball into the water']
      },
      {
        sport: 'baseball',
        triggers: ['fence', 'home run', 'over the fence']
      },
      {
        sport: 'football',
        triggers: ['offside']
      },
      {
        sport: 'basketball',
        triggers: ['traveling']
      }
    ];
  
    for (const rule of sportRules) {
      if (rule.triggers.some(trigger => q.includes(trigger))) {
        return rule.sport;
      }
    }
  
    return null;
  };
  
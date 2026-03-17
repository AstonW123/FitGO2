/* AI Fitness Planner (fully local, no APIs)
   Shared JavaScript logic for all pages:
   - Stores profile, generated plans, and progress logs in localStorage
   - Generates 7-day workout and meal plans using predefined libraries
   - Calculates BMI/BMR/TDEE and goal-adjusted calorie/macro targets
   - Adapts plan display based on progress (behind schedule, latest weight)

   NOTE: This app is intentionally deterministic and offline. All generation is simple rule-based logic,
   not an external AI model (no network calls). */

(function(){
  "use strict";

  const qs = (sel, root=document) => root.querySelector(sel);
  const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const STORAGE = {
    profile: "afit_profile_v1",
    workoutPlan: "afit_workout_plan_v1",
    mealPlan: "afit_meal_plan_v1",
    progress: "afit_progress_v1"
  };

  function loadJSON(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) return fallback;
      return JSON.parse(raw);
    }catch{
      return fallback;
    }
  }

  function saveJSON(key, value){
    localStorage.setItem(key, JSON.stringify(value));
  }

  function pad2(n){ return String(n).padStart(2, "0"); }
  function toISODate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
  function fromISODate(iso){ const [y,m,dd] = iso.split("-").map(Number); return new Date(y, m-1, dd); }
  function addDays(date, days){ const d = new Date(date); d.setDate(d.getDate()+days); return d; }
  function fmtNiceDate(iso){ return fromISODate(iso).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}); }

  function defaultProfile(){
    return {
      goal: "weight_loss",
      level: "beginner",
      daysPerWeek: 3,
      diet: "none",
      restrictions: "",
      weightKg: 70,
      heightCm: 170,
      age: 25,
      gender: "male"
    };
  }

  function defaultProgress(){
    return { workoutCompletions: {}, weightLogs: [], measurementLogs: [] };
  }

  function getProfile(){ return loadJSON(STORAGE.profile, null); }
  function getProgress(){ return loadJSON(STORAGE.progress, defaultProgress()); }

  function getLatestWeightKg(profile, progress){
    if(progress.weightLogs && progress.weightLogs.length){
      const last = progress.weightLogs[progress.weightLogs.length - 1];
      if(last && Number.isFinite(last.weightKg)) return last.weightKg;
    }
    return profile.weightKg;
  }

  function calcBMI(weightKg, heightCm){
    const hM = heightCm / 100;
    if(hM <= 0) return null;
    return weightKg / (hM*hM);
  }

  function calcBMR({weightKg, heightCm, age, gender}){
    const s = gender === "female" ? -161 : 5;
    return 10*weightKg + 6.25*heightCm - 5*age + s;
  }

  function activityFactor(daysPerWeek){
    if(daysPerWeek <= 1) return 1.2;
    if(daysPerWeek <= 3) return 1.375;
    if(daysPerWeek <= 5) return 1.55;
    return 1.725;
  }

  function goalAdjustedCalories(tdee, goal){
    if(goal === "weight_loss") return Math.max(1200, tdee - 450);
    if(goal === "strength") return tdee + 250;
    return Math.max(1300, tdee - 250);
  }

  function macroTargets({goal, weightKg, calories}){
    const proteinPerKg = goal === "strength" ? 1.7 : goal === "defined_abs" ? 2.0 : 2.1;
    const proteinG = Math.round(proteinPerKg * weightKg);
    const proteinCals = proteinG * 4;
    const fatPct = goal === "strength" ? 0.25 : goal === "defined_abs" ? 0.28 : 0.30;
    const fatCals = Math.round(calories * fatPct);
    const fatG = Math.round(fatCals / 9);
    const remainingCals = Math.max(0, calories - proteinCals - fatG*9);
    const carbsG = Math.round(remainingCals / 4);
    return { calories: Math.round(calories), proteinG, carbsG, fatG };
  }

  function computeTargets(profile, progress){
    const weightKg = getLatestWeightKg(profile, progress);
    const bmi = calcBMI(weightKg, profile.heightCm);
    const bmr = calcBMR({weightKg, heightCm: profile.heightCm, age: profile.age, gender: profile.gender});
    const tdee = bmr * activityFactor(profile.daysPerWeek);
    const calories = goalAdjustedCalories(tdee, profile.goal);
    const macros = macroTargets({goal: profile.goal, weightKg, calories});
    return { weightKg, bmi, bmr, tdee, calories: macros.calories, macros };
  }

  // -----------------------------
  // Libraries: exercises + meals
  // -----------------------------
  // Exercises are grouped so we can assemble routines by goal and fitness level.
  const EXERCISES = {
    push: [
      {name:"Push-ups", equipment:"Bodyweight"},
      {name:"Incline Dumbbell Press", equipment:"Dumbbells"},
      {name:"Overhead Press", equipment:"Barbell/Dumbbells"},
      {name:"Dips (assisted if needed)", equipment:"Bodyweight"},
      {name:"Lateral Raises", equipment:"Dumbbells"},
      {name:"Triceps Rope Pushdown", equipment:"Cable/Band"}
    ],
    pull: [
      {name:"Pull-ups (assisted if needed)", equipment:"Bodyweight"},
      {name:"Lat Pulldown", equipment:"Machine/Band"},
      {name:"Seated Cable Row", equipment:"Machine/Band"},
      {name:"One-Arm Dumbbell Row", equipment:"Dumbbells"},
      {name:"Face Pulls", equipment:"Cable/Band"},
      {name:"Biceps Curls", equipment:"Dumbbells/Band"}
    ],
    legs: [
      {name:"Goblet Squat", equipment:"Dumbbell/Kettlebell"},
      {name:"Back Squat", equipment:"Barbell"},
      {name:"Romanian Deadlift", equipment:"Barbell/Dumbbells"},
      {name:"Lunges", equipment:"Bodyweight/Dumbbells"},
      {name:"Hip Thrust", equipment:"Barbell/Band"},
      {name:"Calf Raises", equipment:"Bodyweight/Dumbbells"}
    ],
    core: [
      {name:"Plank", equipment:"Bodyweight"},
      {name:"Dead Bug", equipment:"Bodyweight"},
      {name:"Hanging Knee Raises", equipment:"Bar"},
      {name:"Cable Crunch", equipment:"Cable/Band"},
      {name:"Russian Twists", equipment:"Bodyweight/Plate"},
      {name:"Side Plank", equipment:"Bodyweight"}
    ],
    cardio: [
      {name:"Incline Walk", equipment:"Treadmill/Outdoors"},
      {name:"Jog (easy)", equipment:"Outdoors/Treadmill"},
      {name:"Cycling", equipment:"Bike"},
      {name:"Rowing", equipment:"Rower"},
      {name:"Jump Rope Intervals", equipment:"Rope"},
      {name:"HIIT Sprints (short)", equipment:"Track/Bike"}
    ],
    mobility: [
      {name:"Hip flexor stretch", equipment:"None"},
      {name:"Thoracic rotation", equipment:"None"},
      {name:"Hamstring stretch", equipment:"None"},
      {name:"Ankle mobility rocks", equipment:"None"},
      {name:"Band pull-aparts", equipment:"Band"},
      {name:"Couch stretch", equipment:"None"}
    ]
  };

  // Meals: tagged for dietary filters. Calories/macros are approximate per serving.
  const MEALS = [
    {name:"Greek yogurt + berries + oats", tags:["vegetarian"], type:"breakfast", cals:420, p:28, c:48, f:12},
    {name:"Tofu scramble + toast", tags:["vegan"], type:"breakfast", cals:430, p:26, c:45, f:14},
    {name:"Eggs + avocado + fruit", tags:["none","vegetarian"], type:"breakfast", cals:480, p:25, c:35, f:25},
    {name:"Overnight oats (soy milk) + banana", tags:["vegan"], type:"breakfast", cals:460, p:18, c:70, f:12},
    {name:"Chicken rice bowl + veggies", tags:["none"], type:"lunch", cals:620, p:45, c:70, f:16},
    {name:"Tuna salad wrap + side salad", tags:["none"], type:"lunch", cals:560, p:40, c:45, f:18},
    {name:"Lentil quinoa bowl + tahini", tags:["vegan"], type:"lunch", cals:640, p:28, c:86, f:18},
    {name:"Chickpea pasta + tomato + spinach", tags:["vegan"], type:"lunch", cals:610, p:28, c:85, f:12},
    {name:"Salmon + potatoes + greens", tags:["none"], type:"dinner", cals:680, p:45, c:55, f:28},
    {name:"Lean beef stir fry + rice", tags:["none"], type:"dinner", cals:720, p:50, c:75, f:20},
    {name:"Tempeh + veggie stir fry + rice", tags:["vegan"], type:"dinner", cals:700, p:36, c:85, f:18},
    {name:"Paneer + veg curry + rice", tags:["vegetarian"], type:"dinner", cals:760, p:34, c:78, f:28},
    {name:"Protein shake + banana", tags:["none","vegetarian"], type:"snack", cals:280, p:30, c:30, f:3},
    {name:"Hummus + pita + carrots", tags:["vegan"], type:"snack", cals:320, p:10, c:40, f:14},
    {name:"Cottage cheese + pineapple", tags:["vegetarian"], type:"snack", cals:260, p:26, c:20, f:7},
    {name:"Mixed nuts + apple", tags:["vegan","none","vegetarian"], type:"snack", cals:300, p:8, c:22, f:22}
  ];

  function mealAllowed(meal, diet){
    // "none" means no restrictions; vegetarian/vegan filter appropriately.
    // gluten_free and dairy_free are treated as "avoid likely sources" (approximate).
    if(diet === "none") return true;
    if(diet === "vegetarian") return meal.tags.includes("vegetarian") || meal.tags.includes("vegan") || meal.tags.includes("none");
    if(diet === "vegan") return meal.tags.includes("vegan");
    if(diet === "dairy_free"){
      const dairyWords = ["yogurt", "paneer", "cottage cheese", "cheese"];
      return !dairyWords.some(w => meal.name.toLowerCase().includes(w));
    }
    if(diet === "gluten_free"){
      const glutenWords = ["toast", "wrap", "pita", "oats", "pasta"];
      return !glutenWords.some(w => meal.name.toLowerCase().includes(w));
    }
    return true;
  }

  // -----------------------------
  // Workout plan generation
  // -----------------------------
  function levelPrescription(level, goal){
    // Sets/reps/time are adjusted by level.
    if(goal === "weight_loss"){
      if(level === "advanced") return {sets:4, reps:"10-15", cardioMin:25};
      if(level === "intermediate") return {sets:3, reps:"10-15", cardioMin:20};
      return {sets:3, reps:"8-12", cardioMin:15};
    }
    if(goal === "strength"){
      if(level === "advanced") return {sets:5, reps:"3-6", cardioMin:10};
      if(level === "intermediate") return {sets:4, reps:"5-8", cardioMin:10};
      return {sets:3, reps:"6-10", cardioMin:8};
    }
    if(level === "advanced") return {sets:4, reps:"8-12", cardioMin:18};
    if(level === "intermediate") return {sets:3, reps:"8-12", cardioMin:15};
    return {sets:3, reps:"8-10", cardioMin:12};
  }

  function pickN(arr, n, seed){
    // Simple deterministic picker: rotate by seed then slice.
    const a = arr.slice();
    const shift = a.length ? (seed % a.length) : 0;
    const rotated = a.slice(shift).concat(a.slice(0, shift));
    return rotated.slice(0, Math.min(n, rotated.length));
  }

  function computeWorkoutDays(daysPerWeek){
    // Choose which day indexes (0..6) are workout days and space them evenly.
    const d = Math.max(1, Math.min(7, Math.round(daysPerWeek)));
    if(d === 7) return [0,1,2,3,4,5,6];
    if(d === 6) return [0,1,2,3,4,6];
    if(d === 5) return [0,1,3,4,6];
    if(d === 4) return [0,2,4,6];
    if(d === 3) return [0,2,5];
    if(d === 2) return [1,4];
    return [2];
  }

  function buildWorkoutTypeSequence(workoutDayCount, goal){
    // Determines workout types for workout days (e.g., upper/lower split).
    if(goal !== "strength") return Array.from({length: workoutDayCount}, () => "full");
    if(workoutDayCount >= 5) return ["upper","lower","upper","lower","full"];
    if(workoutDayCount === 4) return ["upper","lower","upper","lower"];
    if(workoutDayCount === 3) return ["full","upper","lower"];
    if(workoutDayCount === 2) return ["upper","lower"];
    return ["full"];
  }

  function buildWorkoutDay({goal, level, dayIndex, workoutType}){
    const rx = levelPrescription(level, goal);
    const seed = (dayIndex + (goal === "strength" ? 7 : goal === "defined_abs" ? 11 : 13));

    if(workoutType === "rest"){
      return {
        title: "Rest / Recovery",
        durationMin: 20,
        exercises: pickN(EXERCISES.mobility, 5, seed).map(e => ({
          name: e.name, detail: "2x 40-60 sec", equipment: e.equipment
        })),
        notes: "Light mobility + an easy walk if you feel good."
      };
    }

    let title = "";
    let blocks = [];
    let finisher = null;

    // Template per goal
    if(goal === "strength"){
      if(workoutType === "upper"){
        title = "Upper Body Strength";
        blocks = [...pickN(EXERCISES.push, 3, seed), ...pickN(EXERCISES.pull, 3, seed+2)];
      }else if(workoutType === "lower"){
        title = "Lower Body Strength";
        blocks = [...pickN(EXERCISES.legs, 5, seed), ...pickN(EXERCISES.core, 1, seed+4)];
      }else{
        title = "Full Body Strength";
        blocks = [
          ...pickN(EXERCISES.legs, 2, seed),
          ...pickN(EXERCISES.push, 2, seed+2),
          ...pickN(EXERCISES.pull, 2, seed+3),
          ...pickN(EXERCISES.core, 1, seed+5)
        ];
      }
      finisher = pickN(EXERCISES.cardio, 1, seed+1)[0];
    }else if(goal === "defined_abs"){
      title = "Lean & Core Focus";
      blocks = [
        ...pickN(EXERCISES.legs, 2, seed),
        ...pickN(EXERCISES.push, 2, seed+2),
        ...pickN(EXERCISES.pull, 2, seed+3),
        ...pickN(EXERCISES.core, 3, seed+1)
      ];
      finisher = pickN(EXERCISES.cardio, 1, seed+4)[0];
    }else{
      title = "Fat Loss Circuit";
      blocks = [
        ...pickN(EXERCISES.legs, 2, seed),
        ...pickN(EXERCISES.push, 2, seed+1),
        ...pickN(EXERCISES.pull, 1, seed+2),
        ...pickN(EXERCISES.core, 2, seed+3)
      ];
      finisher = pickN(EXERCISES.cardio, 1, seed+5)[0];
    }

    const exercises = blocks.map(e => ({
      name: e.name,
      equipment: e.equipment,
      detail: `${rx.sets}x ${rx.reps}`
    }));
    if(finisher){
      exercises.push({
        name: `${finisher.name} (finisher)`,
        equipment: finisher.equipment,
        detail: `${rx.cardioMin} min`
      });
    }
    return {
      title,
      durationMin: Math.max(35, rx.sets * 10 + rx.cardioMin),
      exercises,
      notes: goal === "strength"
        ? "Aim for strong form. Rest 90-150 sec on main lifts."
        : "Keep rest short (30-60 sec). Finish feeling worked, not destroyed."
    };
  }

  function generateWorkoutPlan(profile){
    // Start date is "today". The plan always covers the next 7 local days.
    const startDate = toISODate(new Date());
    const workoutDayIndexes = computeWorkoutDays(profile.daysPerWeek);
    const workoutTypes = buildWorkoutTypeSequence(workoutDayIndexes.length, profile.goal);
    let typeCursor = 0;

    const days = [];
    for(let i=0; i<7; i++){
      const dateISO = toISODate(addDays(new Date(), i));
      const isWorkoutDay = workoutDayIndexes.includes(i);
      const workoutType = isWorkoutDay ? workoutTypes[typeCursor++] : "rest";
      const dayPlan = buildWorkoutDay({goal: profile.goal, level: profile.level, dayIndex: i, workoutType});
      days.push({ date: dateISO, kind: isWorkoutDay ? "workout" : "rest", ...dayPlan });
    }
    return { startDate, days, meta: { goal: profile.goal, level: profile.level, daysPerWeek: profile.daysPerWeek } };
  }

  // -----------------------------
  // Meal plan generation
  // -----------------------------
  function pickMeal(type, diet, seed){
    const candidates = MEALS.filter(m => m.type === type && mealAllowed(m, diet));
    if(!candidates.length) return null;
    return pickN(candidates, 1, seed)[0];
  }

  function scaleMeal(meal, scale){
    // Scale is a simple multiplier to hit calorie targets without complicated recipes.
    const clamp = (n) => Math.max(0, Math.round(n));
    return {
      name: meal.name + (scale !== 1 ? ` (x${scale.toFixed(2)})` : ""),
      cals: clamp(meal.cals * scale),
      p: clamp(meal.p * scale),
      c: clamp(meal.c * scale),
      f: clamp(meal.f * scale)
    };
  }

  function generateMealPlan(profile, targets){
    const startDate = toISODate(new Date());
    const diet = profile.diet;
    const days = [];

    for(let i=0; i<7; i++){
      const seed = i + (profile.goal === "strength" ? 31 : profile.goal === "defined_abs" ? 41 : 51);
      const dateISO = toISODate(addDays(new Date(), i));

      const breakfast = pickMeal("breakfast", diet, seed);
      const lunch = pickMeal("lunch", diet, seed+1);
      const dinner = pickMeal("dinner", diet, seed+2);
      const snack = pickMeal("snack", diet, seed+3);

      const baseTotal = [breakfast,lunch,dinner,snack].reduce((sum, m) => sum + (m ? m.cals : 0), 0);
      const scale = baseTotal > 0 ? (targets.calories / baseTotal) : 1;
      const scaledMeals = [breakfast,lunch,dinner,snack].filter(Boolean).map(m => scaleMeal(m, scale));

      const totals = scaledMeals.reduce((acc, m) => ({
        cals: acc.cals + m.cals,
        p: acc.p + m.p,
        c: acc.c + m.c,
        f: acc.f + m.f
      }), {cals:0, p:0, c:0, f:0});

      days.push({
        date: dateISO,
        meals: [
          {slot:"Breakfast", ...scaledMeals[0]},
          {slot:"Lunch", ...scaledMeals[1]},
          {slot:"Dinner", ...scaledMeals[2]},
          {slot:"Snack", ...scaledMeals[3]}
        ].filter(m => m && m.name),
        totals
      });
    }

    return { startDate, days, meta: { goal: profile.goal, diet: profile.diet, calories: targets.calories, macros: targets.macros } };
  }

  // -----------------------------
  // Progress + adaptation helpers
  // -----------------------------
  function countBehindDays(workoutPlan, progress){
    // "Behind" means a scheduled workout day in the past that is not marked complete.
    if(!workoutPlan || !workoutPlan.days) return 0;
    const todayISO = toISODate(new Date());
    let behind = 0;
    for(const d of workoutPlan.days){
      if(d.kind !== "workout") continue;
      if(d.date < todayISO && !progress.workoutCompletions[d.date]) behind++;
    }
    return behind;
  }

  function motivationalMessage(context){
    // Rotates between a small set of messages. Keeps it fun and non-judgmental.
    const messages = {
      workout: [
        "Start small. Finish strong. Your future self is watching.",
        "Consistency beats intensity. Show up and do the work.",
        "Today counts. Even 20 minutes is a win.",
        "Form first. Then load. Then repeat."
      ],
      nutrition: [
        "Fuel is training too. Hit protein, then build the plate.",
        "Small choices, repeated daily, change everything.",
        "Plan your meals like you plan your workouts.",
        "Eat for the goal you want - not the mood you're in."
      ],
      catchup: [
        "Missed a day? No problem - get the next rep in.",
        "Reset today. One good workout changes the week.",
        "Behind schedule just means today is high impact."
      ]
    };
    const pool = messages[context] || messages.workout;
    return pool[(new Date().getDay() + pool.length) % pool.length];
  }

  // -----------------------------
  // UI utilities (shared)
  // -----------------------------
  function escapeHtml(s){
    return String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function flashNotice(sel, kind, title, msg){
    const el = qs(sel);
    if(!el) return;
    el.className = `notice ${kind}`;
    el.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="muted">${escapeHtml(msg)}</div>`;
  }

  function clampInt(n, min, max, fallback){
    if(!Number.isFinite(n)) return fallback;
    const x = Math.round(n);
    return Math.max(min, Math.min(max, x));
  }
  function clampNum(n, min, max, fallback){
    if(!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }
  function numOrNull(v){
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n*10)/10 : null;
  }

  function labelGoal(goal){
    if(goal === "strength") return "Strength";
    if(goal === "defined_abs") return "Defined Abs";
    return "Weight Loss";
  }
  function labelLevel(level){
    if(level === "advanced") return "Advanced";
    if(level === "intermediate") return "Intermediate";
    return "Beginner";
  }
  function labelDiet(diet){
    const map = {
      none: "No diet filter",
      vegetarian: "Vegetarian",
      vegan: "Vegan",
      gluten_free: "Gluten-free (approx.)",
      dairy_free: "Dairy-free (approx.)"
    };
    return map[diet] || "Diet";
  }

  function setActiveNav(){
    // Highlights the current page in the nav bar.
    const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    qsa(".navlinks a").forEach(a => {
      const href = (a.getAttribute("href") || "").toLowerCase();
      a.classList.toggle("active", href === path);
    });
  }

  function renderPills(profile, targets, progress){
    // Small "status pills" used across pages.
    const el = qs("#statusPills");
    if(!el) return;
    const behind = countBehindDays(loadJSON(STORAGE.workoutPlan, null), progress);
    el.innerHTML = [
      `<span class="pill">${labelGoal(profile.goal)} • ${labelLevel(profile.level)}</span>`,
      `<span class="pill">${profile.daysPerWeek} days/week</span>`,
      `<span class="pill">${labelDiet(profile.diet)}</span>`,
      `<span class="pill ${behind ? "warn" : "good"}">${behind ? `${behind} behind` : "On track"}</span>`,
      `<span class="pill">${targets.calories} kcal/day</span>`
    ].join(" ");
  }

  function drawWeightChart(canvas, weightLogs){
    // Tiny local weight trend chart (no libraries).
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0,0,w,h);

    if(!weightLogs || weightLogs.length < 2){
      ctx.fillStyle = "rgba(232,238,252,0.55)";
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.fillText("Log weight twice to see trend", 10, 22);
      return;
    }

    const data = weightLogs.slice(-14);
    const values = data.map(d => d.weightKg);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = 0.6;
    const lo = min - pad;
    const hi = max + pad;

    const xStep = w / (data.length - 1);
    const yFor = (val) => h - ((val - lo) / (hi - lo)) * (h - 18) - 9;

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for(let i=1; i<=3; i++){
      const y = Math.round((h*i)/4);
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }

    ctx.strokeStyle = "rgba(110,231,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, idx) => {
      const x = idx * xStep;
      const y = yFor(d.weightKg);
      if(idx === 0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.stroke();

    ctx.fillStyle = "rgba(167,139,250,0.95)";
    data.forEach((d, idx) => {
      const x = idx * xStep;
      const y = yFor(d.weightKg);
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    });

    ctx.fillStyle = "rgba(232,238,252,0.75)";
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText(`${values[0]} kg`, 8, 16);
    ctx.fillText(`${values[values.length-1]} kg`, w-70, 16);
  }

  // -----------------------------
  // Page logic
  // -----------------------------
  function initHome(){
    const profile = getProfile();
    const progress = getProgress();
    const callout = qs("#homeCallout");
    const nextWorkout = qs("#nextWorkout");
    const kpi = qs("#homeKpi");

    if(!profile){
      if(callout){
        callout.className = "notice warn";
        callout.innerHTML = `<strong>Start here</strong><div class="muted">Create your profile to generate your 7-day workout and meal plan.</div>`;
      }
      if(nextWorkout) nextWorkout.innerHTML = `<div class="muted">No plan yet. Go to <a href="profile.html">Profile</a> to generate one.</div>`;
      if(kpi) kpi.innerHTML = "";
      return;
    }

    const targets = computeTargets(profile, progress);
    renderPills(profile, targets, progress);

    const workoutPlan = loadJSON(STORAGE.workoutPlan, null);
    const todayISO = toISODate(new Date());
    let next = workoutPlan?.days?.find(d => d.kind === "workout" && d.date >= todayISO && !progress.workoutCompletions[d.date]);
    if(!next) next = workoutPlan?.days?.find(d => d.kind === "workout" && !progress.workoutCompletions[d.date]);

    if(nextWorkout){
      if(next){
        nextWorkout.innerHTML = `
          <div class="item">
            <h3>${fmtNiceDate(next.date)} • ${escapeHtml(next.title)}</h3>
            <div class="meta">${next.durationMin} min • ${escapeHtml(motivationalMessage(countBehindDays(workoutPlan, progress) ? "catchup" : "workout"))}</div>
            <div class="actions">
              <a class="btn primary" href="workouts.html">Open workout plan</a>
              <a class="btn" href="tracker.html">Mark progress</a>
            </div>
          </div>`;
      }else{
        nextWorkout.innerHTML = `<div class="muted">No workout found yet. Generate your plan on <a href="profile.html">Profile</a>.</div>`;
      }
    }

    if(kpi){
      kpi.innerHTML = `
        <div class="box"><div class="label">BMI</div><div class="value">${targets.bmi ? targets.bmi.toFixed(1) : "-"}</div></div>
        <div class="box"><div class="label">BMR</div><div class="value">${Math.round(targets.bmr)} kcal</div></div>
        <div class="box"><div class="label">Target</div><div class="value">${targets.calories} kcal</div></div>`;
    }
  }

  function initProfile(){
    const form = qs("#profileForm");
    const summary = qs("#profileSummary");
    const generateBtn = qs("#generatePlansBtn");
    const clearBtn = qs("#clearDataBtn");
    const tip = qs("#profileTip");

    const existing = getProfile() || defaultProfile();
    if(form){
      form.goal.value = existing.goal;
      form.level.value = existing.level;
      form.daysPerWeek.value = String(existing.daysPerWeek);
      form.diet.value = existing.diet;
      form.restrictions.value = existing.restrictions || "";
      form.weightKg.value = existing.weightKg;
      form.heightCm.value = existing.heightCm;
      form.age.value = existing.age;
      form.gender.value = existing.gender;
    }

    function readForm(){
      const days = clampInt(Number(form.daysPerWeek.value), 1, 7, 3);
      const weightKg = clampNum(Number(form.weightKg.value), 30, 250, 70);
      const heightCm = clampNum(Number(form.heightCm.value), 120, 230, 170);
      const age = clampInt(Number(form.age.value), 10, 100, 25);
      return {
        goal: form.goal.value,
        level: form.level.value,
        daysPerWeek: days,
        diet: form.diet.value,
        restrictions: (form.restrictions.value || "").trim(),
        weightKg,
        heightCm,
        age,
        gender: form.gender.value
      };
    }

    function updateSummary(){
      const progress = getProgress();
      const profile = readForm();
      const targets = computeTargets(profile, progress);
      if(summary){
        summary.innerHTML = `
          <div class="kpi">
            <div class="box"><div class="label">Goal</div><div class="value">${labelGoal(profile.goal)}</div></div>
            <div class="box"><div class="label">Target calories</div><div class="value">${targets.calories} kcal</div></div>
            <div class="box"><div class="label">Macros</div><div class="value">${targets.macros.proteinG}P / ${targets.macros.carbsG}C / ${targets.macros.fatG}F</div></div>
          </div>
          <div class="divider"></div>
          <div class="small">Tip: update weight in the tracker to keep calories/macros accurate.</div>`;
      }
      if(tip) tip.textContent = motivationalMessage("nutrition");
    }

    if(form){
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        saveJSON(STORAGE.profile, readForm());
        updateSummary();
        flashNotice("#profileNotice", "good", "Saved", "Profile updated locally in this browser.");
      });
      qsa("input, select, textarea", form).forEach(el => el.addEventListener("change", updateSummary));
      updateSummary();
    }

    if(generateBtn){
      generateBtn.addEventListener("click", () => {
        const profile = readForm();
        saveJSON(STORAGE.profile, profile);
        const progress = getProgress();
        const targets = computeTargets(profile, progress);
        saveJSON(STORAGE.workoutPlan, generateWorkoutPlan(profile));
        saveJSON(STORAGE.mealPlan, generateMealPlan(profile, targets));
        flashNotice("#profileNotice", "good", "Generated", "7-day workout + meal plans created. Open them from the navigation.");
      });
    }

    if(clearBtn){
      clearBtn.addEventListener("click", () => {
        if(!confirm("Clear profile, plans, and progress from this browser?")) return;
        Object.values(STORAGE).forEach(k => localStorage.removeItem(k));
        flashNotice("#profileNotice", "warn", "Cleared", "All local data removed. Refresh to start again.");
        setTimeout(() => location.reload(), 650);
      });
    }
  }

  function initWorkouts(){
    const profile = getProfile();
    const progress = getProgress();
    const storedPlan = loadJSON(STORAGE.workoutPlan, null);
    const notice = qs("#workoutNotice");
    const tableBody = qs("#workoutTableBody");
    const regenBtn = qs("#regenWorkoutsBtn");
    const behindEl = qs("#behindSummary");

    if(!profile){
      if(notice){
        notice.className = "notice warn";
        notice.innerHTML = `<strong>No profile yet</strong><div class="muted">Create your profile first, then generate a plan.</div><div class="actions"><a class="btn primary" href="profile.html">Go to Profile</a></div>`;
      }
      return;
    }

    const targets = computeTargets(profile, progress);
    renderPills(profile, targets, progress);

    const workoutPlan = storedPlan || generateWorkoutPlan(profile);
    if(!storedPlan) saveJSON(STORAGE.workoutPlan, workoutPlan);

    const behind = countBehindDays(workoutPlan, progress);
    if(behindEl){
      behindEl.innerHTML = behind
        ? `<div class="notice warn"><strong>Urgent: ${behind} workout day(s) behind</strong><div class="muted">${escapeHtml(motivationalMessage("catchup"))} Open the tracker to mark completed sessions.</div></div>`
        : `<div class="notice good"><strong>On track</strong><div class="muted">${escapeHtml(motivationalMessage("workout"))}</div></div>`;
    }

    if(tableBody){
      const todayISO = toISODate(new Date());
      tableBody.innerHTML = workoutPlan.days.map(d => {
        const completed = !!progress.workoutCompletions[d.date];
        const urgent = d.kind === "workout" && d.date < todayISO && !completed;
        const rowClass = urgent ? "urgent" : completed ? "completed" : (d.kind === "rest" ? "rest" : "");
        const exercises = d.exercises.map(x => `${escapeHtml(x.name)} - ${escapeHtml(x.detail)}`).join("<br>");
        return `
          <tr class="${rowClass}">
            <td><strong>${fmtNiceDate(d.date)}</strong><div class="small">${d.kind === "rest" ? "Recovery" : "Workout"}</div></td>
            <td>${escapeHtml(d.title)}<div class="small">${d.durationMin} min</div></td>
            <td>${exercises}</td>
            <td class="small">${escapeHtml(d.notes)}</td>
            <td>${d.kind === "workout" ? `<a class="btn" href="tracker.html">Update</a>` : `<span class="muted">-</span>`}</td>
          </tr>`;
      }).join("");
    }

    if(regenBtn){
      regenBtn.addEventListener("click", () => {
        saveJSON(STORAGE.workoutPlan, generateWorkoutPlan(profile));
        flashNotice("#workoutNotice", "good", "Regenerated", "Workout plan updated for the next 7 days.");
        setTimeout(() => location.reload(), 350);
      });
    }
  }

  function initMeals(){
    const profile = getProfile();
    const progress = getProgress();
    const notice = qs("#mealNotice");
    const planWrap = qs("#mealPlanWrap");
    const regenBtn = qs("#regenMealsBtn");
    const header = qs("#mealHeader");

    if(!profile){
      if(notice){
        notice.className = "notice warn";
        notice.innerHTML = `<strong>No profile yet</strong><div class="muted">Create your profile first, then generate a meal plan.</div><div class="actions"><a class="btn primary" href="profile.html">Go to Profile</a></div>`;
      }
      return;
    }

    const targets = computeTargets(profile, progress);
    renderPills(profile, targets, progress);

    const stored = loadJSON(STORAGE.mealPlan, null);
    const basePlan = stored || generateMealPlan(profile, targets);

    // Adaptation: if targets change (usually from a new weight log), rescale displayed meals on-the-fly.
    // This keeps the plan "the same foods" but adjusted portions for the new calorie target.
    const storedCalories = basePlan?.meta?.calories;
    const delta = storedCalories ? (targets.calories - storedCalories) : 0;
    const scaleIfNeeded = (day) => {
      if(!day || !day.meals?.length) return day;
      const current = day.totals?.cals || day.meals.reduce((s,m) => s + (m.cals||0), 0);
      if(!current) return day;
      const scale = targets.calories / current;
      // Within ±5%, don't bother re-scaling to avoid noisy changes.
      if(scale > 0.95 && scale < 1.05) return day;
      const clamp = (n) => Math.max(0, Math.round(n));
      const meals = day.meals.map(m => ({
        ...m,
        name: `${m.name} (adjusted)`,
        cals: clamp(m.cals * scale),
        p: clamp(m.p * scale),
        c: clamp(m.c * scale),
        f: clamp(m.f * scale)
      }));
      const totals = meals.reduce((acc, m) => ({
        cals: acc.cals + m.cals,
        p: acc.p + m.p,
        c: acc.c + m.c,
        f: acc.f + m.f
      }), {cals:0, p:0, c:0, f:0});
      return {...day, meals, totals};
    };

    const displayPlan = {
      ...basePlan,
      meta: { ...basePlan.meta, calories: targets.calories, macros: targets.macros },
      days: (basePlan.days || []).map(scaleIfNeeded)
    };
    if(header){
      header.innerHTML = `
        <div class="notice ${Math.abs(delta) >= 120 ? "warn" : "good"}">
          <strong>Daily target: ${targets.calories} kcal • ${targets.macros.proteinG}P / ${targets.macros.carbsG}C / ${targets.macros.fatG}F</strong>
          <div class="muted">${escapeHtml(motivationalMessage("nutrition"))}${storedCalories ? ` Base plan: ${storedCalories} kcal/day. Display adapts to new targets automatically.` : ""}</div>
        </div>`;
    }

    if(!stored) saveJSON(STORAGE.mealPlan, basePlan);

    if(planWrap){
      planWrap.innerHTML = displayPlan.days.map(d => {
        const rows = d.meals.map(m => `
          <tr>
            <td><strong>${escapeHtml(m.slot)}</strong></td>
            <td>${escapeHtml(m.name)}</td>
            <td>${m.cals}</td>
            <td>${m.p}</td>
            <td>${m.c}</td>
            <td>${m.f}</td>
          </tr>`).join("");

        return `
          <div class="card">
            <h2>${fmtNiceDate(d.date)}</h2>
            <div class="small">Totals: ${d.totals.cals} kcal • ${d.totals.p}P / ${d.totals.c}C / ${d.totals.f}F</div>
            <div class="divider"></div>
            <table class="table">
              <thead><tr><th>Meal</th><th>What</th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      }).join("");
    }

    if(regenBtn){
      regenBtn.addEventListener("click", () => {
        saveJSON(STORAGE.mealPlan, generateMealPlan(profile, targets));
        flashNotice("#mealNotice", "good", "Regenerated", "Meal plan updated using your latest targets.");
        setTimeout(() => location.reload(), 350);
      });
    }
  }

  function initTracker(){
    const profile = getProfile();
    const progress = getProgress();
    const workoutPlan = loadJSON(STORAGE.workoutPlan, null);
    const notice = qs("#trackerNotice");
    const workoutsWrap = qs("#trackerWorkouts");
    const weightForm = qs("#weightForm");
    const measForm = qs("#measForm");
    const chart = qs("#weightChart");
    const stats = qs("#trackerStats");

    if(!profile || !workoutPlan){
      if(notice){
        notice.className = "notice warn";
        notice.innerHTML = `<strong>Missing profile or plan</strong><div class="muted">Create a profile and generate your plans first.</div><div class="actions"><a class="btn primary" href="profile.html">Go to Profile</a></div>`;
      }
      return;
    }

    const targets = computeTargets(profile, progress);
    renderPills(profile, targets, progress);

    function saveProgress(){
      saveJSON(STORAGE.progress, progress);
    }

    function render(){
      const behind = countBehindDays(workoutPlan, progress);
      if(stats){
        stats.innerHTML = `
          <div class="kpi">
            <div class="box"><div class="label">Workouts behind</div><div class="value">${behind}</div></div>
            <div class="box"><div class="label">Latest weight</div><div class="value">${getLatestWeightKg(profile, progress)} kg</div></div>
            <div class="box"><div class="label">Today</div><div class="value">${fmtNiceDate(toISODate(new Date()))}</div></div>
          </div>`;
      }

      if(workoutsWrap){
        const todayISO = toISODate(new Date());
        workoutsWrap.innerHTML = `
          <table class="table">
            <thead><tr><th>Day</th><th>Workout</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              ${workoutPlan.days.map(d => {
                const isWorkout = d.kind === "workout";
                const completed = !!progress.workoutCompletions[d.date];
                const urgent = isWorkout && d.date < todayISO && !completed;
                const rowClass = urgent ? "urgent" : completed ? "completed" : (isWorkout ? "" : "rest");
                const statusPill = !isWorkout
                  ? `<span class="pill">Rest</span>`
                  : completed
                    ? `<span class="pill good">Done</span>`
                    : urgent
                      ? `<span class="pill warn">Urgent</span>`
                      : `<span class="pill">Planned</span>`;
                const btn = !isWorkout
                  ? `<span class="muted">-</span>`
                  : `<button class="btn ${completed ? "" : "primary"}" data-toggle="${d.date}">${completed ? "Undo" : "Mark done"}</button>`;
                return `
                  <tr class="${rowClass}">
                    <td><strong>${fmtNiceDate(d.date)}</strong></td>
                    <td>${escapeHtml(d.title)}</td>
                    <td>${statusPill}</td>
                    <td>${btn}</td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>`;
      }

      qsa("[data-toggle]").forEach(btn => {
        btn.addEventListener("click", () => {
          const date = btn.getAttribute("data-toggle");
          if(progress.workoutCompletions[date]) delete progress.workoutCompletions[date];
          else progress.workoutCompletions[date] = true;
          saveProgress();
          render();
        });
      });

      drawWeightChart(chart, progress.weightLogs);
    }

    if(weightForm){
      weightForm.date.value = toISODate(new Date());
      weightForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const w = Number(weightForm.weightKg.value);
        if(!Number.isFinite(w) || w <= 0){
          flashNotice("#trackerNotice", "bad", "Invalid", "Enter a valid weight.");
          return;
        }
        const date = weightForm.date.value || toISODate(new Date());
        progress.weightLogs.push({date, weightKg: Math.round(w*10)/10});
        progress.weightLogs = progress.weightLogs.sort((a,b) => a.date.localeCompare(b.date)).slice(-60);
        saveProgress();
        flashNotice("#trackerNotice", "good", "Logged", "Weight saved. Meal targets update automatically.");
        weightForm.reset();
        weightForm.date.value = toISODate(new Date());
        render();
      });
    }

    if(measForm){
      measForm.date.value = toISODate(new Date());
      measForm.addEventListener("submit", (e) => {
        e.preventDefault();
        progress.measurementLogs.push({
          date: measForm.date.value || toISODate(new Date()),
          waistCm: numOrNull(measForm.waistCm.value),
          hipsCm: numOrNull(measForm.hipsCm.value),
          chestCm: numOrNull(measForm.chestCm.value),
          armsCm: numOrNull(measForm.armsCm.value),
          thighsCm: numOrNull(measForm.thighsCm.value)
        });
        progress.measurementLogs = progress.measurementLogs.sort((a,b) => a.date.localeCompare(b.date)).slice(-60);
        saveProgress();
        flashNotice("#trackerNotice", "good", "Logged", "Measurements saved locally.");
        measForm.reset();
        measForm.date.value = toISODate(new Date());
      });
    }

    render();
  }

  function initCalculator(){
    const profile = getProfile();
    const progress = getProgress();
    const notice = qs("#calcNotice");
    const out = qs("#calcOut");

    if(!profile){
      if(notice){
        notice.className = "notice warn";
        notice.innerHTML = `<strong>No profile yet</strong><div class="muted">Create your profile to calculate BMI/BMR/calorie needs.</div><div class="actions"><a class="btn primary" href="profile.html">Go to Profile</a></div>`;
      }
      return;
    }

    const targets = computeTargets(profile, progress);
    renderPills(profile, targets, progress);

    if(out){
      out.innerHTML = `
        <table class="table">
          <thead><tr><th>Metric</th><th>Value</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td><strong>BMI</strong></td><td>${targets.bmi ? targets.bmi.toFixed(1) : "-"}</td><td class="small">BMI = weight(kg)/height(m)^2</td></tr>
            <tr><td><strong>BMR</strong></td><td>${Math.round(targets.bmr)} kcal/day</td><td class="small">Mifflin-St Jeor estimate</td></tr>
            <tr><td><strong>TDEE</strong></td><td>${Math.round(targets.tdee)} kcal/day</td><td class="small">BMR x activity factor (from training days/week)</td></tr>
            <tr><td><strong>Goal calories</strong></td><td>${targets.calories} kcal/day</td><td class="small">${labelGoal(profile.goal)} adjustment</td></tr>
            <tr><td><strong>Protein</strong></td><td>${targets.macros.proteinG} g/day</td><td class="small">Goal-based g/kg target</td></tr>
            <tr><td><strong>Carbs</strong></td><td>${targets.macros.carbsG} g/day</td><td class="small">Remainder after protein + fats</td></tr>
            <tr><td><strong>Fats</strong></td><td>${targets.macros.fatG} g/day</td><td class="small">Goal-based % of calories</td></tr>
          </tbody>
        </table>`;
    }
  }

  // -----------------------------
  // Boot per page
  // -----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    setActiveNav();
    const page = document.body.getAttribute("data-page");
    if(page === "home") initHome();
    if(page === "profile") initProfile();
    if(page === "workouts") initWorkouts();
    if(page === "meals") initMeals();
    if(page === "tracker") initTracker();
    if(page === "calculator") initCalculator();
  });
})();

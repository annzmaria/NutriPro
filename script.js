/* ============================================
   NUTRIPRO — ADVANCED SCRIPT ENGINE
   ============================================ */

'use strict';

// =========================================
// GLOBAL STATE
// =========================================
let currentUser = null;
let currentPlan = [];
let groceryState = {};
let weightLog = [];
let metricsData = {};
let activeDayIndex = 0;
let selectedMealCount = 3;
let charts = {};
let swapContext = null; // { dayIndex, mealType }

// =========================================
// AUTH
// =========================================
const authSection = document.getElementById('auth-section');
const mainApp = document.getElementById('main-app');
const authForm = document.getElementById('auth-form');

const savedUser = localStorage.getItem('nutripro_user');
if (savedUser) {
    try {
        currentUser = JSON.parse(savedUser);
        initApp();
    } catch(e) {
        localStorage.removeItem('nutripro_user');
    }
}

authForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const name = document.getElementById('user-name').value.trim();
    const email = document.getElementById('user-email').value.trim();
    if (!name || !email) return;

    const btn = document.getElementById('auth-submit-btn');
    btn.innerHTML = '<span>Loading...</span>';

    fetch('api/login.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('nutripro_user', JSON.stringify(currentUser));
            initApp();
        } else {
            showError('Login failed: ' + (data.message || 'Unknown error'));
            btn.innerHTML = '<span>Start My Journey</span><span class="btn-icon">→</span>';
        }
    })
    .catch(() => {
        // Fallback: offline mode with localStorage only
        currentUser = { id: 'local_' + Date.now(), name, email };
        localStorage.setItem('nutripro_user', JSON.stringify(currentUser));
        initApp();
    });
});

function initApp() {
    authSection.style.opacity = '0';
    setTimeout(() => {
        authSection.classList.add('hidden');
        mainApp.classList.remove('hidden');
        updateUserUI();
        loadSavedData();
        navigateTo('home');
    }, 500);
}

function updateUserUI() {
    if (!currentUser) return;
    const name = currentUser.name || 'User';
    const avatar = name.charAt(0).toUpperCase();
    document.getElementById('user-name-pill').textContent = name;
    document.getElementById('user-avatar-sm').textContent = avatar;
    document.getElementById('profile-avatar-large').textContent = avatar;
    document.getElementById('profile-name-display').textContent = name;
    document.getElementById('profile-email-display').textContent = currentUser.email || '—';
    document.getElementById('profile-name').textContent = name;
}

function loadSavedData() {
    const key = 'nutripro_plan_' + (currentUser?.id || 'guest');
    const saved = localStorage.getItem(key);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            currentPlan = data.plan || [];
            groceryState = data.groceryState || {};
            weightLog = data.weightLog || [];
            metricsData = data.metrics || {};
            selectedMealCount = data.selectedMealCount || 3;
            if (currentPlan.length > 0) {
                applyMetricsToUI(metricsData);
                renderDayTabs();
                renderDayContent(0);
                renderGroceryList();
                updateProfileView(data.inputs || {});
                // Restore health tips from saved inputs
                const inp = data.inputs || metricsData.inputs || {};
                showHealthTips(
                    inp.conditions || [],
                    inp.dietType || 'any',
                    inp.goalType || 'loss',
                    metricsData.bmi || 22
                );
                showGoalTimeline(metricsData);
                navigateTo('diet');
            }
        } catch(e) { console.warn('Failed to load saved plan', e); }
    }

    // Also try API
    if (currentUser?.id && !String(currentUser.id).startsWith('local_')) {
        fetch(`api/get_plan.php?user_id=${currentUser.id}`)
        .then(r => r.json())
        .then(data => {
            if (data.success && data.plan) {
                mergeFromAPI(data.plan);
            }
        })
        .catch(() => {});
    }
}

function mergeFromAPI(planData) {
    if (!planData) return;
    if (planData.plan && planData.plan.length > 0) {
        currentPlan = planData.plan;
        metricsData = { targetCalories: planData.targetCalories, waterIntake: planData.waterIntake, bmi: planData.bmi, ...planData };
        groceryState = planData.groceryState || {};
        applyMetricsToUI(metricsData);
        renderDayTabs();
        renderDayContent(activeDayIndex);
        renderGroceryList();
        if (planData.inputs) {
            updateProfileView(planData.inputs);
            showHealthTips(
                planData.inputs.conditions || [],
                planData.inputs.dietType || 'any',
                planData.inputs.goalType || 'loss',
                metricsData.bmi || 22
            );
        }
        showGoalTimeline(metricsData);
    }
}

window.logout = function() {
    if (confirm('Logout from NutriPro?')) {
        localStorage.removeItem('nutripro_user');
        location.reload();
    }
};

// =========================================
// NAVIGATION
// =========================================
window.navigateTo = function(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const view = document.getElementById(`${viewId}-view`);
    if (view) view.classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const navBtn = document.getElementById(`nav-${viewId}`);
    if (navBtn) navBtn.classList.add('active');

    if (viewId === 'tracker' && metricsData.targetCalories) {
        setTimeout(renderAnalytics, 100);
    }
};

// =========================================
// THEME TOGGLE
// =========================================
const savedTheme = localStorage.getItem('nutripro_theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeIcon();

window.toggleTheme = function() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('nutripro_theme', next);
    updateThemeIcon();
    // Redraw charts for theme change
    if (metricsData.targetCalories) setTimeout(renderAnalytics, 100);
};
function updateThemeIcon() {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
}

// =========================================
// STEP WIZARD
// =========================================
let currentStep = 1;
const totalSteps = 4;

window.goStep = function(stepNum) {
    // Validate step 1 before moving forward
    if (stepNum > currentStep && currentStep === 1) {
        const age = document.getElementById('age').value;
        const height = document.getElementById('height').value;
        const weight = document.getElementById('weight').value;
        if (!age || !height || !weight) {
            showError('Please fill in Age, Height and Weight to continue.');
            return;
        }
    }

    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`form-step-${stepNum}`).classList.add('active');

    for (let i = 1; i <= totalSteps; i++) {
        const dot = document.getElementById(`step-dot-${i}`);
        dot.classList.remove('active', 'done');
        if (i < stepNum) dot.classList.add('done');
        if (i === stepNum) dot.classList.add('active');
    }
    currentStep = stepNum;
};

// Live BMI preview
['height','weight'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateLiveBMI);
});
function updateLiveBMI() {
    const h = parseFloat(document.getElementById('height').value);
    const w = parseFloat(document.getElementById('weight').value);
    if (!h || !w || h < 100 || w < 30) {
        document.getElementById('live-bmi-preview').style.display = 'none';
        return;
    }
    const bmi = (w / Math.pow(h/100, 2)).toFixed(1);
    document.getElementById('live-bmi-value').textContent = bmi;
    let cat = 'Normal Weight', pct = 50;
    if (bmi < 18.5) { cat = 'Underweight ⚠️'; pct = 13; }
    else if (bmi < 25) { cat = 'Normal Weight ✅'; pct = 38; }
    else if (bmi < 30) { cat = 'Overweight ⚠️'; pct = 65; }
    else { cat = 'Obese 🔴'; pct = 88; }
    document.getElementById('live-bmi-label').textContent = `BMI — ${cat}`;
    document.getElementById('bmi-indicator').style.left = `${pct}%`;
    document.getElementById('live-bmi-preview').style.display = 'block';
}

// Pace selector
document.querySelectorAll('input[name="pace"]').forEach(radio => {
    radio.addEventListener('change', function() {
        document.querySelectorAll('.pace-card').forEach(c => c.classList.remove('selected'));
        this.closest('.pace-option').querySelector('.pace-card').classList.add('selected');
    });
});

// Meal count selector
window.selectMealCount = function(count, btn) {
    selectedMealCount = count;
    document.querySelectorAll('.meal-count-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
};

// Show/hide pace for maintain
document.getElementById('goal-type').addEventListener('change', function() {
    document.getElementById('pace-group').style.opacity = this.value === 'maintain' ? '0.4' : '1';
});

// =========================================
// FORM SUBMIT — GENERATE PLAN
// =========================================
document.getElementById('diet-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const btn = document.getElementById('generate-btn');
    btn.innerHTML = '<span>⏳ Generating...</span>';
    btn.disabled = true;

    setTimeout(() => {
        try {
            generatePlan();
            btn.innerHTML = '<span>✨ Generate My Plan</span>';
            btn.disabled = false;
        } catch(err) {
            showError('Error generating plan: ' + err.message);
            btn.innerHTML = '<span>✨ Generate My Plan</span>';
            btn.disabled = false;
        }
    }, 600);
});

function generatePlan() {
    const age = parseInt(document.getElementById('age').value);
    const gender = document.getElementById('gender').value;
    const height = parseFloat(document.getElementById('height').value);
    const weight = parseFloat(document.getElementById('weight').value);
    const targetWeightInput = parseFloat(document.getElementById('target-weight').value);
    const activity = parseFloat(document.getElementById('activity').value);
    const goalType = document.getElementById('goal-type').value;
    const cuisine = document.getElementById('cuisine').value;
    const dietType = document.getElementById('diet-type').value;
    const pace = document.querySelector('input[name="pace"]:checked')?.value || 'moderate';
    const conditions = Array.from(document.querySelectorAll('#condition-grid input:checked')).map(c => c.value);

    // BMR — Mifflin-St Jeor
    const bmr = gender === 'male'
        ? (10 * weight) + (6.25 * height) - (5 * age) + 5
        : (10 * weight) + (6.25 * height) - (5 * age) - 161;

    const tdee = bmr * activity;
    const paceDeficit = { gentle: 250, moderate: 500, aggressive: 750 };
    const deficit = paceDeficit[pace] || 500;

    let targetCalories;
    if (goalType === 'maintain' || goalType === 'recomp') { targetCalories = tdee; }
    else if (goalType === 'gain') { targetCalories = tdee + deficit; }
    else { targetCalories = tdee - deficit; } // loss

    // Special diets
    if (dietType === 'pregnancy') { targetCalories = Math.max(tdee + 300, 1800); }
    if (dietType === 'post-delivery') { targetCalories = Math.max(tdee + 500, 2000); }
    if (dietType === 'keto') { /* Keto is very low-carb, same calories */ }

    // Safety minimums
    if (gender === 'male' && targetCalories < 1500) targetCalories = 1500;
    if (gender === 'female' && targetCalories < 1200) targetCalories = 1200;

    targetCalories = Math.round(targetCalories);

    // Macro split
    const macros = calculateMacros(targetCalories, dietType, goalType);

    // Body metrics
    const bmi = +(weight / Math.pow(height/100, 2)).toFixed(1);
    const waterIntake = +(weight * 0.033).toFixed(1);
    const bodyFat = estimateBodyFat(bmi, age, gender);
    const lbm = +(weight * (1 - bodyFat/100)).toFixed(1);
    const idealWeightMin = +(22 * Math.pow(height/100, 2)).toFixed(1);
    const idealWeightMax = +(25 * Math.pow(height/100, 2)).toFixed(1);

    // Goal timeline
    let weeksToGoal = null;
    if (!isNaN(targetWeightInput) && targetWeightInput > 0) {
        const diff = Math.abs(weight - targetWeightInput);
        const kgPerWeek = deficit / 7700;
        weeksToGoal = Math.ceil(diff / kgPerWeek);
    }

    metricsData = {
        targetCalories, bmr: Math.round(bmr), tdee: Math.round(tdee),
        deficit: goalType === 'gain' ? +deficit : -deficit,
        macros, bmi, waterIntake, bodyFat,
        lbm, idealWeightMin, idealWeightMax, weeksToGoal, targetWeight: targetWeightInput,
        goalType, dietType, cuisine, inputs: {
            age, gender, height, weight, activity,
            goalType, dietType, cuisine, pace, conditions,
            targetWeight: targetWeightInput
        }
    };

    // Generate 7 day plan
    let preference = 'any';
    if (['veg', 'vegan'].includes(dietType)) preference = 'veg';
    else if (['keto', 'high-protein', 'low-carb', 'diabetic', 'heart-healthy'].includes(dietType)) preference = dietType;

    currentPlan = [];
    for (let i = 0; i < 7; i++) {
        currentPlan.push(createDayPlan(targetCalories, preference, cuisine, selectedMealCount));
    }
    groceryState = {};

    // Update UI
    applyMetricsToUI(metricsData);
    renderDayTabs();
    renderDayContent(0);
    renderGroceryList();
    updateProfileView(metricsData.inputs);
    showGoalTimeline(metricsData);
    showHealthTips(conditions, dietType, goalType, bmi);
    saveData();
    navigateTo('diet');
}

function calculateMacros(calories, dietType, goalType) {
    let proteinPct, carbPct, fatPct;
    switch(dietType) {
        case 'keto':        proteinPct=0.25; carbPct=0.05; fatPct=0.70; break;
        case 'high-protein':proteinPct=0.35; carbPct=0.40; fatPct=0.25; break;
        case 'low-carb':    proteinPct=0.30; carbPct=0.20; fatPct=0.50; break;
        case 'vegan':       proteinPct=0.20; carbPct=0.55; fatPct=0.25; break;
        case 'diabetic':    proteinPct=0.25; carbPct=0.40; fatPct=0.35; break;
        default:
            if (goalType === 'recomp') { proteinPct=0.35; carbPct=0.40; fatPct=0.25; }
            else if (goalType === 'gain') { proteinPct=0.30; carbPct=0.45; fatPct=0.25; }
            else { proteinPct=0.30; carbPct=0.40; fatPct=0.30; }
    }
    return {
        protein: Math.round((calories * proteinPct) / 4),
        carbs:   Math.round((calories * carbPct) / 4),
        fats:    Math.round((calories * fatPct) / 9),
        proteinPct: Math.round(proteinPct * 100),
        carbPct:    Math.round(carbPct * 100),
        fatPct:     Math.round(fatPct * 100)
    };
}

function estimateBodyFat(bmi, age, gender) {
    // Deurenberg formula approximation
    const bf = (1.20 * bmi) + (0.23 * age) - (10.8 * (gender === 'male' ? 1 : 0)) - 5.4;
    return Math.max(5, Math.min(50, +bf.toFixed(1)));
}

function applyMetricsToUI(m) {
    if (!m || !m.targetCalories) return;
    safeSet('daily-calories', m.targetCalories);
    safeSet('water-intake', m.waterIntake + 'L');
    safeSet('bmi-value', m.bmi);
    safeSet('ribbon-protein', (m.macros?.protein || '--') + 'g');
    safeSet('ribbon-carbs', (m.macros?.carbs || '--') + 'g');
    safeSet('ribbon-fats', (m.macros?.fats || '--') + 'g');
    safeSet('profile-weight', m.inputs?.weight || '--');
    safeSet('profile-height', m.inputs?.height || '--');
    safeSet('profile-bmi', m.bmi || '--');
    safeSet('ph-calories', m.targetCalories);
    safeSet('ph-bmi', m.bmi);
    safeSet('ph-water', m.waterIntake + 'L');
}

function showGoalTimeline(m) {
    const banner = document.getElementById('goal-timeline-banner');
    if (m.weeksToGoal && m.targetWeight) {
        banner.style.display = 'flex';
        const dir = m.goalType === 'gain' ? 'gain' : 'lose';
        document.getElementById('timeline-main').textContent = `Goal: ${dir === 'gain' ? '📈' : '📉'} Reach ${m.targetWeight} kg`;
        document.getElementById('timeline-sub').textContent = `At current pace — estimated ${m.weeksToGoal} weeks`;
        document.getElementById('timeline-badge').textContent = `~${m.weeksToGoal} wks`;
    } else {
        banner.style.display = 'none';
    }
}

const healthTips = {
    diabetes:    '🩺 Prioritize low-GI foods and avoid refined sugars. Space meals evenly to maintain stable blood sugar.',
    hypertension:'❤️ Reduce sodium intake. Focus on potassium-rich foods like bananas, sweet potatoes, and leafy greens.',
    cholesterol: '🧪 Choose healthy fats (olive oil, avocado, nuts). Minimize saturated fats and trans fats.',
    thyroid:     '🦋 Ensure adequate iodine and selenium. Avoid raw cruciferous vegetables in excess.',
    pcos:        '💊 Low-GI diet and regular exercise help manage PCOS. Reduce refined carbs and processed foods.',
    ibs:         '🫁 Follow a low-FODMAP approach. Identify trigger foods and eat slowly.',
    gluten:      '🌾 Strictly avoid wheat, barley, and rye. Focus on naturally gluten-free grains like rice and quinoa.',
    lactose:     '🥛 Use plant-based alternatives. Lactase enzyme supplements can help with accidental exposure.',
    keto:        '🥑 Your plan is optimized for ketosis. Keep net carbs under 20–30g/day. Prioritize healthy fats.',
    'high-protein':'💪 Distribute protein evenly across meals for optimal muscle protein synthesis.',
    vegan:       '🌱 Monitor B12, iron, calcium, and omega-3 intake. Consider supplementation.',
    pregnancy:   '🤱 Ensure adequate folate, iron, calcium, and DHA. Avoid raw/undercooked foods.',
    loss:        '⚡ Eat slowly and mindfully. High protein + fiber keeps you full longer. Stay hydrated!',
    gain:        '💪 Focus on caloric surplus from whole foods. Post-workout nutrition is key.',
    default:     '💡 Consistency is key! Aim to eat 80% whole foods. Allow 20% flexibility to stay on track long-term.'
};

function showHealthTips(conditions, dietType, goalType, bmi) {
    const tipEl = document.getElementById('tips-text');
    let tip = null;
    for (const c of conditions) {
        if (healthTips[c]) { tip = healthTips[c]; break; }
    }
    if (!tip && healthTips[dietType]) tip = healthTips[dietType];
    if (!tip && healthTips[goalType]) tip = healthTips[goalType];
    if (!tip) tip = healthTips.default;
    if (bmi >= 30 && !tip) tip = '⚠️ Your BMI indicates obesity. A moderate calorie deficit with regular exercise is recommended. Consult your doctor.';
    tipEl.textContent = tip;
}

window.regeneratePlan = function() {
    document.getElementById('diet-form').dispatchEvent(new Event('submit'));
};

// =========================================
// FOOD DATABASE (ADVANCED — 200+ MEALS)
// =========================================
const MEALS = {
    breakfast: [
        // Kerala / South Indian
        {name:"Puttu (1 cup) + Kadala Curry",cal:350,protein:12,carbs:52,fats:8,type:"veg",cuisine:"kerala",tags:["high-fiber"],ing:["Rice Flour","Grated Coconut","Black Chickpeas","Onion","Spices"]},
        {name:"Idli (3 pcs) + Sambar + Coconut Chutney",cal:290,protein:10,carbs:50,fats:4,type:"veg",cuisine:"kerala",tags:[],ing:["Idli Batter","Toor Dal","Vegetables","Coconut","Spices"]},
        {name:"Dosa (2 pcs) + Sambar",cal:340,protein:9,carbs:55,fats:6,type:"veg",cuisine:"kerala",tags:[],ing:["Dosa Batter","Toor Dal","Vegetables","Oil","Spices"]},
        {name:"Appam (2) + Egg Roast",cal:390,protein:14,carbs:50,fats:12,type:"non-veg",cuisine:"kerala",tags:["high-protein"],ing:["Appam Batter","Eggs","Onion","Tomato","Spices"]},
        {name:"Kerala Parotta (2) + Vegetable Kurma",cal:480,protein:11,carbs:65,fats:16,type:"veg",cuisine:"kerala",tags:[],ing:["Maida Flour","Mixed Vegetables","Coconut Milk","Spices"]},
        {name:"Oats Upma + Boiled Egg",cal:310,protein:16,carbs:38,fats:8,type:"non-veg",cuisine:"kerala",tags:["high-protein","low-cal"],ing:["Oats","Vegetables","Egg","Mustard Seeds","Curry Leaves"]},
        {name:"Pesarattu (2) + Ginger Chutney",cal:280,protein:13,carbs:42,fats:5,type:"veg",cuisine:"kerala",tags:["high-protein"],ing:["Green Moong Dal","Ginger","Green Chilli","Rice","Spices"]},

        // North Indian
        {name:"Aloo Paratha (2) + Curd",cal:440,protein:11,carbs:60,fats:14,type:"veg",cuisine:"indian",tags:[],ing:["Wheat Flour","Potato","Curd","Butter","Spices"]},
        {name:"Moong Dal Chilla (2) + Green Chutney",cal:290,protein:16,carbs:38,fats:5,type:"veg",cuisine:"indian",tags:["high-protein","low-fat"],ing:["Moong Dal","Onion","Green Chilli","Ginger","Coriander"]},
        {name:"Poha + Peanuts",cal:320,protein:9,carbs:52,fats:7,type:"veg",cuisine:"indian",tags:[],ing:["Flattened Rice","Peanuts","Onion","Mustard Seeds","Turmeric"]},
        {name:"Upma + Boiled Egg",cal:330,protein:15,carbs:44,fats:8,type:"non-veg",cuisine:"indian",tags:["high-protein"],ing:["Semolina","Mixed Vegetables","Egg","Mustard Seeds","Curry Leaves"]},
        {name:"Stuffed Egg Paratha + Raita",cal:460,protein:18,carbs:52,fats:16,type:"non-veg",cuisine:"indian",tags:[],ing:["Wheat Flour","Eggs","Curd","Onion","Spices"]},

        // Arabic / Middle Eastern
        {name:"Ful Medames (Fava Bean Stew) + Bread",cal:370,protein:16,carbs:55,fats:7,type:"veg",cuisine:"arabic",tags:["high-fiber","high-protein"],ing:["Fava Beans","Lemon Juice","Olive Oil","Garlic","Cumin"]},
        {name:"Shakshuka (2 eggs) + Pita",cal:420,protein:22,carbs:40,fats:18,type:"non-veg",cuisine:"arabic",tags:["high-protein"],ing:["Eggs","Tomatoes","Bell Peppers","Onion","Cumin","Coriander","Pita Bread"]},
        {name:"Hummus + Pita + Mixed Olives",cal:380,protein:12,carbs:48,fats:15,type:"veg",cuisine:"arabic",tags:[],ing:["Chickpeas","Tahini","Lemon","Garlic","Olive Oil","Pita Bread","Olives"]},
        {name:"Labneh + Za'atar + Whole Wheat Bread",cal:320,protein:14,carbs:35,fats:12,type:"veg",cuisine:"arabic",tags:["high-protein"],ing:["Labneh (Strained Yogurt)","Za'atar","Olive Oil","Whole Wheat Bread"]},

        // Filipino
        {name:"Tapsilog — Beef Tapa + Garlic Rice + Egg (small)",cal:510,protein:28,carbs:48,fats:18,type:"non-veg",cuisine:"filipino",tags:["high-protein"],ing:["Beef","Rice","Egg","Garlic","Vinegar","Soy Sauce"]},
        {name:"Pandesal (2) + Scrambled Egg + Coffee",cal:330,protein:14,carbs:44,fats:8,type:"non-veg",cuisine:"filipino",tags:[],ing:["Flour","Egg","Milk","Salt","Coffee"]},
        {name:"Tortang Talong + Rice (½ cup)",cal:310,protein:13,carbs:38,fats:10,type:"veg",cuisine:"filipino",tags:[],ing:["Eggplant","Eggs","Rice","Salt","Oil"]},
        {name:"Champorado (Chocolate Rice Porridge) + Dried Fish",cal:380,protein:10,carbs:60,fats:9,type:"non-veg",cuisine:"filipino",tags:[],ing:["Sticky Rice","Cocoa Powder","Sugar","Evaporated Milk","Dried Fish"]},

        // Continental
        {name:"Greek Yogurt Parfait + Berries + Granola",cal:340,protein:18,carbs:45,fats:8,type:"veg",cuisine:"continental",tags:["high-protein","low-fat"],ing:["Greek Yogurt","Mixed Berries","Granola","Honey","Chia Seeds"]},
        {name:"Avocado Toast (2 slices) + Poached Egg",cal:410,protein:17,carbs:38,fats:20,type:"non-veg",cuisine:"continental",tags:["heart-healthy"],ing:["Whole Grain Bread","Avocado","Egg","Lemon Juice","Chili Flakes"]},
        {name:"Overnight Oats + Almond Butter + Banana",cal:420,protein:14,carbs:58,fats:14,type:"veg",cuisine:"continental",tags:["high-fiber"],ing:["Rolled Oats","Almond Milk","Almond Butter","Banana","Chia Seeds"]},
        {name:"Veggie Omelette (3 eggs) + Whole Grain Toast",cal:380,protein:26,carbs:28,fats:18,type:"non-veg",cuisine:"continental",tags:["high-protein","keto"],ing:["Eggs","Bell Peppers","Mushrooms","Spinach","Whole Grain Bread"]},

        // Asian
        {name:"Congee (Rice Porridge) + Boiled Egg",cal:290,protein:14,carbs:42,fats:6,type:"non-veg",cuisine:"asian",tags:["low-fat"],ing:["Rice","Ginger","Spring Onion","Egg","Soy Sauce","Sesame Oil"]},
        {name:"Onigiri (2) + Miso Soup",cal:320,protein:10,carbs:58,fats:4,type:"veg",cuisine:"asian",tags:[],ing:["Japanese Rice","Nori","Miso Paste","Tofu","Wakame"]},
        {name:"Thai Basil Omelette + Jasmine Rice (½ cup)",cal:360,protein:20,carbs:38,fats:14,type:"non-veg",cuisine:"asian",tags:["high-protein"],ing:["Eggs","Thai Basil","Fish Sauce","Garlic","Chilli","Rice"]},

        // Keto / Low-Carb
        {name:"Bulletproof Coffee + Bacon + Eggs",cal:490,protein:22,carbs:3,fats:42,type:"non-veg",cuisine:"mixed",tags:["keto","low-carb"],ing:["Coffee","Butter","MCT Oil","Bacon","Eggs"]},
        {name:"Egg Muffins (3) with Cheese & Veggies",cal:320,protein:24,carbs:5,fats:22,type:"non-veg",cuisine:"mixed",tags:["keto","high-protein"],ing:["Eggs","Cheddar Cheese","Bell Peppers","Spinach","Onion"]},
        {name:"Smoked Salmon + Cream Cheese Rollups",cal:360,protein:28,carbs:4,fats:26,type:"non-veg",cuisine:"continental",tags:["keto","high-protein"],ing:["Smoked Salmon","Cream Cheese","Cucumber","Dill","Lemon"]},

        // High Protein
        {name:"Protein Smoothie Bowl (Whey + Banana + Oats)",cal:420,protein:35,carbs:50,fats:7,type:"veg",cuisine:"mixed",tags:["high-protein"],ing:["Whey Protein","Banana","Rolled Oats","Almond Milk","Berries"]},
        {name:"Cottage Cheese (1 cup) + Apple + Walnuts",cal:310,protein:24,carbs:28,fats:10,type:"veg",cuisine:"mixed",tags:["high-protein","diabetic"],ing:["Cottage Cheese","Apple","Walnuts","Cinnamon"]},
    ],

    lunch: [
        // Kerala
        {name:"Kerala Rice (1 cup) + Fish Curry + Thoran",cal:510,protein:28,carbs:60,fats:14,type:"non-veg",cuisine:"kerala",tags:["high-protein"],ing:["Matta Rice","Fish","Tamarind","Coconut","Spices","Vegetables"]},
        {name:"Kerala Rice + Sambar + Moru Curry + Thoran",cal:450,protein:12,carbs:72,fats:8,type:"veg",cuisine:"kerala",tags:["high-fiber"],ing:["Matta Rice","Toor Dal","Vegetables","Yogurt","Coconut","Spices"]},
        {name:"Chicken Biriyani (Kerala Style) + Raita",cal:580,protein:32,carbs:65,fats:18,type:"non-veg",cuisine:"kerala",tags:["high-protein"],ing:["Basmati Rice","Chicken","Onion","Spices","Yogurt","Ghee"]},
        {name:"Karimeen Pollichathu (Pearl Spot Fish on Leaf)",cal:380,protein:34,carbs:8,fats:20,type:"non-veg",cuisine:"kerala",tags:["keto","high-protein"],ing:["Pearl Spot Fish","Banana Leaf","Shallots","Spices","Coconut Oil"]},
        {name:"Sambar Rice + Papad + Pickle",cal:420,protein:13,carbs:70,fats:6,type:"veg",cuisine:"kerala",tags:[],ing:["Rice","Toor Dal","Mixed Vegetables","Spices","Papadum"]},

        // North Indian
        {name:"Rajma Chawal (Red Kidney Beans + Rice)",cal:490,protein:18,carbs:75,fats:8,type:"veg",cuisine:"indian",tags:["high-fiber","high-protein"],ing:["Red Kidney Beans","Rice","Tomato","Onion","Spices","Ghee"]},
        {name:"Dal Tadka + Jeera Rice + Salad",cal:440,protein:17,carbs:65,fats:9,type:"veg",cuisine:"indian",tags:["high-protein"],ing:["Yellow Dal","Rice","Cumin","Ghee","Onion","Tomato","Spices"]},
        {name:"Palak Paneer + 2 Chapati",cal:510,protein:22,carbs:48,fats:20,type:"veg",cuisine:"indian",tags:["high-protein"],ing:["Spinach","Paneer","Wheat Flour","Cream","Spices"]},
        {name:"Chicken Curry + Rice (1 cup)",cal:530,protein:35,carbs:52,fats:16,type:"non-veg",cuisine:"indian",tags:["high-protein"],ing:["Chicken","Rice","Tomato","Onion","Yogurt","Spices"]},
        {name:"Chole Bhature (smaller serving)",cal:560,protein:16,carbs:72,fats:18,type:"veg",cuisine:"indian",tags:["high-fiber"],ing:["Chickpeas","Maida Flour","Tomato","Onion","Spices"]},
        {name:"Tuna Salad + Multigrain Chapati (2)",cal:400,protein:32,carbs:38,fats:10,type:"non-veg",cuisine:"indian",tags:["high-protein","low-fat"],ing:["Tuna","Cucumber","Tomato","Onion","Lemon","Wheat Flour"]},

        // Arabic
        {name:"Chicken Shawarma Wrap",cal:490,protein:32,carbs:45,fats:16,type:"non-veg",cuisine:"arabic",tags:["high-protein"],ing:["Chicken Thighs","Pita Bread","Garlic Sauce","Letttuce","Tomato","Onion","Sumac"]},
        {name:"Lamb Kabsa (Arabic Rice Dish)",cal:560,protein:35,carbs:58,fats:18,type:"non-veg",cuisine:"arabic",tags:[],ing:["Lamb","Basmati Rice","Raisins","Almonds","Spices","Onion","Tomato"]},
        {name:"Falafel Plate + Hummus + Salad + Pita",cal:470,protein:16,carbs:60,fats:15,type:"veg",cuisine:"arabic",tags:["high-fiber"],ing:["Chickpeas","Parsley","Cumin","Coriander","Sesame","Pita Bread","Hummus","Tomato","Cucumber"]},
        {name:"Mujaddara (Lentils + Rice + Caramelized Onion)",cal:400,protein:15,carbs:65,fats:8,type:"veg",cuisine:"arabic",tags:["diabetic","high-fiber"],ing:["Green Lentils","Rice","Onion","Olive Oil","Cumin","Coriander"]},

        // Filipino
        {name:"Chicken Adobo + Rice",cal:540,protein:35,carbs:52,fats:16,type:"non-veg",cuisine:"filipino",tags:["high-protein"],ing:["Chicken","Soy Sauce","Vinegar","Garlic","Bay Leaves","Peppercorns","Rice"]},
        {name:"Sinigang na Hipon (Prawn Tamarind Soup) + Rice",cal:430,protein:28,carbs:52,fats:8,type:"non-veg",cuisine:"filipino",tags:["low-fat","high-protein"],ing:["Prawns","Tamarind","Kangkong","Radish","Tomato","Onion","Rice"]},
        {name:"Tinolang Manok + Rice",cal:420,protein:30,carbs:48,fats:10,type:"non-veg",cuisine:"filipino",tags:["low-fat"],ing:["Chicken","Ginger","Green Papaya","Chili Leaves","Fish Sauce","Rice"]},
        {name:"Pinakbet + Grilled Pork + Rice",cal:480,protein:26,carbs:50,fats:14,type:"non-veg",cuisine:"filipino",tags:[],ing:["Pumpkin","Eggplant","String Beans","Okra","Bitter Melon","Shrimp Paste","Pork","Rice"]},
        {name:"Monggo Guisado + Rice (veg)",cal:420,protein:16,carbs:68,fats:6,type:"veg",cuisine:"filipino",tags:["high-fiber","vegan"],ing:["Mung Beans","Garlic","Onion","Tomato","Spinach","Rice"]},

        // Continental
        {name:"Grilled Chicken Caesar Salad (no croutons)",cal:380,protein:38,carbs:10,fats:18,type:"non-veg",cuisine:"continental",tags:["keto","high-protein","low-carb"],ing:["Chicken Breast","Romaine Lettuce","Parmesan","Caesar Dressing","Lemon"]},
        {name:"Quinoa Buddha Bowl + Roasted Veggies + Tahini",cal:450,protein:18,carbs:55,fats:16,type:"veg",cuisine:"continental",tags:["high-fiber","heart-healthy"],ing:["Quinoa","Sweet Potato","Chickpeas","Broccoli","Tahini","Lemon","Olive Oil"]},
        {name:"Grilled Salmon + Steamed Broccoli + Brown Rice",cal:520,protein:42,carbs:40,fats:16,type:"non-veg",cuisine:"continental",tags:["high-protein","heart-healthy"],ing:["Salmon Fillet","Broccoli","Brown Rice","Lemon","Olive Oil","Garlic"]},
        {name:"Turkey Wrap with Avocado",cal:440,protein:30,carbs:38,fats:16,type:"non-veg",cuisine:"continental",tags:["high-protein"],ing:["Turkey Breast","Whole Wheat Tortilla","Avocado","Lettuce","Tomato","Mustard"]},
        {name:"Lentil Soup + Whole Grain Bread + Greek Salad",cal:410,protein:20,carbs:58,fats:9,type:"veg",cuisine:"continental",tags:["high-fiber","diabetic"],ing:["Red Lentils","Tomato","Carrot","Cumin","Olive Oil","Feta","Whole Grain Bread"]},

        // Asian
        {name:"Chicken Pad Thai (smaller portion)",cal:490,protein:28,carbs:56,fats:14,type:"non-veg",cuisine:"asian",tags:[],ing:["Rice Noodles","Chicken","Bean Sprouts","Eggs","Peanuts","Fish Sauce","Lime"]},
        {name:"Japanese Salmon Bento (Salmon + Rice + Edamame)",cal:520,protein:38,carbs:52,fats:14,type:"non-veg",cuisine:"asian",tags:["high-protein"],ing:["Salmon","Japanese Rice","Edamame","Pickled Ginger","Soy Sauce"]},
        {name:"Tofu + Bok Choy Stir-Fry + Jasmine Rice",cal:380,protein:18,carbs:50,fats:10,type:"veg",cuisine:"asian",tags:["vegan","low-fat"],ing:["Firm Tofu","Bok Choy","Garlic","Ginger","Soy Sauce","Sesame Oil","Rice"]},
        {name:"Vietnamese Pho (Beef Noodle Soup)",cal:420,protein:30,carbs:45,fats:9,type:"non-veg",cuisine:"asian",tags:["low-fat"],ing:["Beef Brisket","Rice Noodles","Bean Sprouts","Basil","Lime","Star Anise","Broth"]},

        // Keto
        {name:"Bunless Beef Burger + Salad",cal:480,protein:40,carbs:8,fats:32,type:"non-veg",cuisine:"mixed",tags:["keto","high-protein"],ing:["Ground Beef","Cheese","Lettuce","Tomato","Onion","Mustard"]},
        {name:"Chicken & Avocado Lettuce Wraps",cal:380,protein:34,carbs:6,fats:24,type:"non-veg",cuisine:"mixed",tags:["keto","low-carb"],ing:["Chicken Breast","Avocado","Lettuce","Lime","Coriander","Garlic"]},

        // Diabetic / Heart-healthy
        {name:"Grilled Mackerel + Roasted Veggies + Quinoa",cal:440,protein:34,carbs:38,fats:14,type:"non-veg",cuisine:"mixed",tags:["diabetic","heart-healthy","high-protein"],ing:["Mackerel","Quinoa","Zucchini","Bell Pepper","Olive Oil","Lemon"]},
        {name:"Chickpea & Spinach Stew + Brown Rice",cal:400,protein:18,carbs:58,fats:8,type:"veg",cuisine:"mixed",tags:["diabetic","heart-healthy","vegan"],ing:["Chickpeas","Spinach","Tomato","Onion","Garlic","Cumin","Brown Rice"]},
    ],

    dinner: [
        // Kerala
        {name:"Chapati (2) + Chicken Curry",cal:380,protein:28,carbs:40,fats:12,type:"non-veg",cuisine:"kerala",tags:["high-protein"],ing:["Wheat Flour","Chicken","Tomato","Onion","Spices"]},
        {name:"Kerala Wheat Dosa (2) + Coconut Chutney",cal:300,protein:8,carbs:50,fats:8,type:"veg",cuisine:"kerala",tags:[],ing:["Wheat Flour","Coconut","Spices","Shallots"]},
        {name:"Appam (2) + Mutton Stew",cal:450,protein:26,carbs:48,fats:16,type:"non-veg",cuisine:"kerala",tags:[],ing:["Appam Batter","Mutton","Potato","Coconut Milk","Spices"]},
        {name:"Fish Moilee + Rice (½ cup)",cal:400,protein:30,carbs:38,fats:14,type:"non-veg",cuisine:"kerala",tags:["high-protein","heart-healthy"],ing:["Fish","Coconut Milk","Turmeric","Green Chilli","Ginger","Curry Leaves","Rice"]},
        {name:"Vegetable Stew + Appam (2)",cal:340,protein:8,carbs:55,fats:10,type:"veg",cuisine:"kerala",tags:["vegan"],ing:["Mixed Vegetables","Coconut Milk","Ginger","Green Chilli","Appam Batter"]},
        {name:"Prawn Pepper Fry + Chapati (2)",cal:420,protein:32,carbs:38,fats:14,type:"non-veg",cuisine:"kerala",tags:["keto","high-protein"],ing:["Prawns","Pepper","Garlic","Curry Leaves","Coconut Oil","Wheat Flour"]},

        // North Indian
        {name:"Dal Makhani + 2 Roti + Salad",cal:460,protein:18,carbs:58,fats:14,type:"veg",cuisine:"indian",tags:["high-fiber"],ing:["Black Lentils","Kidney Beans","Cream","Butter","Tomato","Spices","Wheat Flour"]},
        {name:"Paneer Tikka + 2 Roti",cal:490,protein:28,carbs:40,fats:22,type:"veg",cuisine:"indian",tags:["high-protein"],ing:["Paneer","Capsicum","Onion","Curd","Spices","Wheat Flour"]},
        {name:"Grilled Tandoori Chicken (2 pieces) + Mint Chutney",cal:350,protein:42,carbs:8,fats:14,type:"non-veg",cuisine:"indian",tags:["keto","high-protein","low-carb"],ing:["Chicken","Yogurt","Lemon","Ginger","Garlic","Tandoori Masala"]},
        {name:"Baingan Bharta + 2 Chapati",cal:380,protein:10,carbs:52,fats:12,type:"veg",cuisine:"indian",tags:["vegan"],ing:["Eggplant","Tomato","Onion","Garlic","Spices","Wheat Flour"]},

        // Arabic
        {name:"Grilled Lamb Kofta + Arabic Rice + Salad",cal:520,protein:38,carbs:42,fats:20,type:"non-veg",cuisine:"arabic",tags:["high-protein"],ing:["Ground Lamb","Parsley","Onion","Spices","Basmati Rice","Tomato","Cucumber"]},
        {name:"Grilled Chicken Shish Tawook + Garlic Sauce",cal:380,protein:40,carbs:10,fats:18,type:"non-veg",cuisine:"arabic",tags:["keto","high-protein"],ing:["Chicken Breast","Lemon","Garlic","Yogurt","Spices","Garlic Paste"]},
        {name:"Vegetarian Stuffed Peppers (Arabic Style)",cal:340,protein:12,carbs:48,fats:10,type:"veg",cuisine:"arabic",tags:["diabetic"],ing:["Bell Peppers","Rice","Tomato","Parsley","Onion","Olive Oil","Spices"]},
        {name:"Lentil Soup (Adas) + Fattoush Salad",cal:360,protein:16,carbs:52,fats:8,type:"veg",cuisine:"arabic",tags:["high-fiber","diabetic","vegan"],ing:["Red Lentils","Cumin","Lemon","Olive Oil","Romaine","Tomato","Pita","Sumac"]},

        // Filipino
        {name:"Pancit Bihon (Rice Noodles with Chicken)",cal:400,protein:24,carbs:52,fats:8,type:"non-veg",cuisine:"filipino",tags:[],ing:["Rice Noodles","Chicken","Carrot","Cabbage","Soy Sauce","Calamansi Juice"]},
        {name:"Ginisang Ampalaya (Bitter Melon + Egg)",cal:280,protein:14,carbs:12,fats:16,type:"veg",cuisine:"filipino",tags:["keto","diabetic","low-carb"],ing:["Bitter Melon","Eggs","Garlic","Onion","Tomato","Oil"]},
        {name:"Tilapia na may Tausi (Tilapia + Black Beans)",cal:350,protein:32,carbs:14,fats:14,type:"non-veg",cuisine:"filipino",tags:["diabetic","high-protein"],ing:["Tilapia","Black Beans","Ginger","Garlic","Soy Sauce","Sesame Oil"]},
        {name:"Chopsuey (Filipino Stir-Fry Veggies) + Rice",cal:380,protein:16,carbs:55,fats:8,type:"non-veg",cuisine:"filipino",tags:[],ing:["Vegetables","Pork","Shrimp","Oyster Sauce","Garlic","Onion","Rice"]},

        // Continental
        {name:"Baked Chicken Breast + Roasted Sweet Potato + Greens",cal:440,protein:42,carbs:30,fats:12,type:"non-veg",cuisine:"continental",tags:["high-protein","heart-healthy"],ing:["Chicken Breast","Sweet Potato","Broccoli","Olive Oil","Garlic","Herbs"]},
        {name:"Pasta Primavera with Whole Wheat Pasta",cal:460,protein:16,carbs:68,fats:12,type:"veg",cuisine:"continental",tags:["heart-healthy"],ing:["Whole Wheat Pasta","Zucchini","Bell Peppers","Cherry Tomatoes","Olive Oil","Garlic","Basil"]},
        {name:"Beef Stir-Fry + Brown Rice",cal:500,protein:36,carbs:48,fats:14,type:"non-veg",cuisine:"continental",tags:["high-protein"],ing:["Beef Strips","Bell Peppers","Broccoli","Soy Sauce","Ginger","Brown Rice"]},
        {name:"Mushroom Risotto (light version)",cal:390,protein:12,carbs:60,fats:10,type:"veg",cuisine:"continental",tags:[],ing:["Arborio Rice","Mushrooms","Onion","White Wine","Parmesan","Olive Oil"]},
        {name:"Baked Salmon + Asparagus + Lemon Butter",cal:440,protein:40,carbs:6,fats:26,type:"non-veg",cuisine:"continental",tags:["keto","high-protein","heart-healthy"],ing:["Salmon Fillet","Asparagus","Butter","Lemon","Garlic","Dill"]},

        // Asian
        {name:"Chicken Teriyaki + Steamed Rice + Edamame",cal:490,protein:36,carbs:52,fats:10,type:"non-veg",cuisine:"asian",tags:["high-protein"],ing:["Chicken Thigh","Teriyaki Sauce","Rice","Edamame","Sesame Seeds"]},
        {name:"Miso Ramen with Soft Boiled Egg",cal:460,protein:26,carbs:58,fats:12,type:"non-veg",cuisine:"asian",tags:[],ing:["Ramen Noodles","Miso Paste","Egg","Corn","Nori","Spring Onion","Broth"]},
        {name:"Thai Green Curry (Chicken) + Jasmine Rice",cal:510,protein:30,carbs:52,fats:16,type:"non-veg",cuisine:"asian",tags:[],ing:["Chicken","Green Curry Paste","Coconut Milk","Zucchini","Basil","Rice"]},
        {name:"Vegetable Fried Rice (Chinese)",cal:380,protein:10,carbs:60,fats:10,type:"veg",cuisine:"asian",tags:["vegan"],ing:["Rice","Mixed Vegetables","Soy Sauce","Sesame Oil","Garlic","Ginger"]},

        // Keto
        {name:"Zucchini Noodles + Meat Sauce",cal:380,protein:30,carbs:12,fats:22,type:"non-veg",cuisine:"mixed",tags:["keto","low-carb","high-protein"],ing:["Zucchini","Ground Beef","Tomato","Garlic","Olive Oil","Parmesan"]},
        {name:"Cauliflower Fried Rice + Chicken",cal:360,protein:32,carbs:10,fats:18,type:"non-veg",cuisine:"mixed",tags:["keto","low-carb"],ing:["Cauliflower","Chicken","Eggs","Garlic","Soy Sauce","Sesame Oil"]},
    ],

    snack: [
        // All-round healthy snacks
        {name:"Apple + 1 tbsp Peanut Butter",cal:170,protein:5,carbs:22,fats:8,type:"veg",cuisine:"mixed",tags:["heart-healthy"],ing:["Apple","Peanut Butter"]},
        {name:"Greek Yogurt (150g) + Berries",cal:140,protein:12,carbs:14,fats:3,type:"veg",cuisine:"mixed",tags:["high-protein","low-fat","diabetic"],ing:["Greek Yogurt","Mixed Berries"]},
        {name:"Mixed Nuts (30g)",cal:180,protein:5,carbs:7,fats:16,type:"veg",cuisine:"mixed",tags:["keto","heart-healthy"],ing:["Almonds","Walnuts","Cashews"]},
        {name:"Boiled Eggs (2)",cal:140,protein:12,carbs:1,fats:10,type:"non-veg",cuisine:"mixed",tags:["keto","high-protein"],ing:["Eggs","Salt"]},
        {name:"Hummus (4 tbsp) + Carrot & Cucumber Sticks",cal:160,protein:6,carbs:18,fats:7,type:"veg",cuisine:"arabic",tags:["diabetic","heart-healthy"],ing:["Hummus","Carrot","Cucumber"]},
        {name:"Banana",cal:90,protein:1,carbs:23,fats:0,type:"veg",cuisine:"mixed",tags:[],ing:["Banana"]},
        {name:"Protein Bar (homemade oats-date bar)",cal:210,protein:8,carbs:30,fats:7,type:"veg",cuisine:"mixed",tags:[],ing:["Rolled Oats","Dates","Nuts","Honey","Peanut Butter"]},
        {name:"Chai (Indian Spiced Tea) + 2 Digestive Biscuits",cal:130,protein:3,carbs:22,fats:4,type:"veg",cuisine:"indian",tags:[],ing:["Tea","Milk","Ginger","Cardamom","Biscuits"]},
        {name:"Coconut Water (300ml)",cal:60,protein:0,carbs:15,fats:0,type:"veg",cuisine:"mixed",tags:["low-cal","diabetic"],ing:["Coconut Water"]},
        {name:"Sprouts Salad (100g)",cal:110,protein:8,carbs:16,fats:1,type:"veg",cuisine:"indian",tags:["high-protein","low-fat","diabetic","vegan"],ing:["Mixed Sprouts","Tomato","Onion","Lemon","Coriander"]},
        {name:"Cheese Cubes (30g) + Cherry Tomatoes",cal:140,protein:8,carbs:4,fats:10,type:"veg",cuisine:"continental",tags:["keto"],ing:["Cheddar Cheese","Cherry Tomatoes"]},
        {name:"Mango Lassi (small glass)",cal:150,protein:5,carbs:26,fats:3,type:"veg",cuisine:"indian",tags:[],ing:["Mango","Yogurt","Sugar","Cardamom"]},
        {name:"Dates (3) + Almonds (10)",cal:160,protein:4,carbs:26,fats:7,type:"veg",cuisine:"arabic",tags:["heart-healthy"],ing:["Dates","Almonds"]},
        {name:"Turon (Banana Spring Roll - 1 pc)",cal:200,protein:2,carbs:32,fats:8,type:"veg",cuisine:"filipino",tags:[],ing:["Saba Banana","Spring Roll Wrapper","Brown Sugar","Oil"]},
        {name:"Edamame (½ cup, salted)",cal:95,protein:8,carbs:8,fats:4,type:"veg",cuisine:"asian",tags:["keto","high-protein","vegan"],ing:["Edamame","Sea Salt"]},
        {name:"Rice Cakes (2) + Avocado",cal:160,protein:4,carbs:20,fats:8,type:"veg",cuisine:"continental",tags:["gluten"],ing:["Rice Cakes","Avocado","Lemon","Salt"]},
        {name:"Banana Fry (1 piece)",cal:150,protein:1,carbs:24,fats:6,type:"veg",cuisine:"kerala",tags:[],ing:["Banana","Oil"]},
        {name:"Whey Protein Shake + Milk",cal:200,protein:28,carbs:12,fats:3,type:"non-veg",cuisine:"mixed",tags:["high-protein"],ing:["Whey Protein","Milk","Banana"]},
        {name:"Celery Sticks + Peanut Butter (1 tbsp)",cal:100,protein:4,carbs:6,fats:8,type:"veg",cuisine:"continental",tags:["keto","low-carb"],ing:["Celery","Peanut Butter"]},
        {name:"Small Bowl of Curd + Honey",cal:120,protein:6,carbs:16,fats:3,type:"veg",cuisine:"indian",tags:["diabetic"],ing:["Curd","Honey"]},
    ],

    // Extra mini-meals (for 5-6 meal plans)
    mini_meal_1: [], // Will mirror snack
    mini_meal_2: [], // Will mirror breakfast (lighter)
};
// Fill mini meals from snacks
MEALS.mini_meal_1 = MEALS.snack;
MEALS.mini_meal_2 = MEALS.snack;

// =========================================
// PLAN GENERATION
// =========================================
const MEAL_SLOTS = {
    3: ['breakfast','lunch','dinner'],
    4: ['breakfast','lunch','snack','dinner'],
    5: ['breakfast','snack','lunch','mini_meal_1','dinner'],
    6: ['breakfast','snack','lunch','mini_meal_1','dinner','mini_meal_2'],
};
const MEAL_LABELS = {
    breakfast:'Breakfast', lunch:'Lunch', snack:'Snack', dinner:'Dinner',
    mini_meal_1:'Afternoon Snack', mini_meal_2:'Evening Snack'
};
const MEAL_ICONS = {
    breakfast:'🌅', lunch:'☀️', snack:'🍎', dinner:'🌙',
    mini_meal_1:'🍊', mini_meal_2:'🌜'
};

function createDayPlan(targetCalories, preference, cuisine, mealCount = 4) {
    const slots = MEAL_SLOTS[mealCount] || MEAL_SLOTS[4];
    const day = { meals: {}, total: 0, totalProtein: 0, totalCarbs: 0, totalFats: 0 };
    slots.forEach(slot => {
        const meal = getFilteredMeal(slot, preference, cuisine);
        day.meals[slot] = meal;
        day.total += meal.cal;
        day.totalProtein += meal.protein || 0;
        day.totalCarbs += meal.carbs || 0;
        day.totalFats += meal.fats || 0;
    });
    day.slots = slots;
    return day;
}

function getFilteredMeal(mealType, preference, cuisine) {
    let pool = MEALS[mealType] || MEALS.snack;

    // Preference filter
    if (preference === 'veg') pool = pool.filter(m => m.type === 'veg');
    else if (preference === 'vegan') pool = pool.filter(m => m.tags?.includes('vegan') || m.type === 'veg');
    else if (preference === 'keto') pool = pool.filter(m => m.tags?.includes('keto') || m.carbs < 20);
    else if (preference === 'high-protein') pool = pool.filter(m => m.protein >= 20);
    else if (preference === 'low-carb') pool = pool.filter(m => m.carbs < 30);
    else if (preference === 'diabetic') pool = pool.filter(m => m.tags?.includes('diabetic') || m.carbs < 55);
    else if (preference === 'heart-healthy') pool = pool.filter(m => m.tags?.includes('heart-healthy') || m.fats < 15);

    // Cuisine filter
    if (cuisine && cuisine !== 'mixed') {
        const cui = pool.filter(m => m.cuisine === cuisine);
        if (cui.length >= 1) pool = cui;
    }

    // If pool empty after filtering, fallback
    if (pool.length === 0) pool = MEALS[mealType] || MEALS.snack;

    return pool[Math.floor(Math.random() * pool.length)];
}

// =========================================
// RENDER: DAY TABS
// =========================================
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

function renderDayTabs() {
    const container = document.getElementById('day-tabs');
    container.innerHTML = '';
    DAYS.forEach((day, i) => {
        const btn = document.createElement('button');
        btn.className = 'day-tab' + (i === activeDayIndex ? ' active' : '');
        btn.textContent = day.substring(0, 3);
        btn.onclick = () => { activeDayIndex = i; renderDayContent(i); updateTabs(); };
        container.appendChild(btn);
    });
}

function updateTabs() {
    document.querySelectorAll('.day-tab').forEach((t, i) => {
        t.classList.toggle('active', i === activeDayIndex);
    });
}

// =========================================
// RENDER: DAY CONTENT
// =========================================
function renderDayContent(dayIdx) {
    activeDayIndex = dayIdx;
    const container = document.getElementById('day-content-container');
    container.innerHTML = '';
    if (!currentPlan || !currentPlan[dayIdx]) return;

    const dayPlan = currentPlan[dayIdx];
    const card = document.createElement('div');
    card.className = 'day-meal-card';
    card.innerHTML = `<h4>${DAYS[dayIdx]}'s Meal Plan <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted);margin-left:auto;">${dayPlan.total} kcal planned</span></h4>`;

    (dayPlan.slots || Object.keys(dayPlan.meals)).forEach(slotType => {
        const meal = dayPlan.meals[slotType];
        if (!meal) return;
        const row = document.createElement('div');
        row.className = 'meal-entry';
        row.innerHTML = `
            <span class="meal-type-badge">${MEAL_ICONS[slotType] || ''} ${MEAL_LABELS[slotType] || slotType}</span>
            <span class="meal-entry-name">${meal.name}</span>
            <span class="meal-entry-cals">${meal.cal} kcal</span>
            <div class="meal-actions">
                <button class="btn-meal-action" title="Details" onclick='showMealToast(${JSON.stringify(meal).replace(/'/g,"&apos;")})'>ℹ️</button>
                <button class="btn-meal-action" title="Swap Meal" onclick="openSwapModal(${dayIdx},'${slotType}')">🔄</button>
            </div>
        `;
        card.appendChild(row);
    });

    // Totals
    const totalRow = document.createElement('div');
    totalRow.className = 'day-total-row';
    totalRow.innerHTML = `
        <span class="total-macro">🥩 P: ${dayPlan.totalProtein}g</span>
        <span class="total-macro">🍞 C: ${dayPlan.totalCarbs}g</span>
        <span class="total-macro">🥑 F: ${dayPlan.totalFats}g</span>
        <span class="total-cals">Total: ${dayPlan.total} kcal</span>
    `;
    card.appendChild(totalRow);
    container.appendChild(card);
    updateTabs();
}

// =========================================
// MEAL SWAP MODAL
// =========================================
window.openSwapModal = function(dayIdx, slotType) {
    swapContext = { dayIdx, slotType };
    document.getElementById('swap-modal-slot-label').textContent = `${MEAL_LABELS[slotType]} — ${DAYS[dayIdx]}`;

    const current = currentPlan[dayIdx]?.meals?.[slotType];
    const preference = metricsData.inputs?.preference || 'any';
    const cuisine = metricsData.inputs?.cuisine || 'mixed';
    let pool = MEALS[slotType] || MEALS.snack;

    // Filter same way as generation
    if (['veg','vegan'].includes(metricsData.inputs?.dietType)) pool = pool.filter(m => m.type === 'veg');

    // Show a sample of options (up to 8 unique)
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 8);
    const list = document.getElementById('swap-options-list');
    list.innerHTML = '';
    shuffled.forEach(meal => {
        const opt = document.createElement('div');
        opt.className = 'swap-option';
        opt.innerHTML = `
            <div class="swap-option-name">${meal.name}</div>
            <div class="swap-option-cal">${meal.cal} kcal</div>
        `;
        opt.onclick = () => confirmSwap(meal);
        list.appendChild(opt);
    });

    document.getElementById('swap-modal').classList.remove('hidden');
};

function confirmSwap(meal) {
    const { dayIdx, slotType } = swapContext;
    const old = currentPlan[dayIdx].meals[slotType];
    currentPlan[dayIdx].meals[slotType] = meal;

    // Recompute totals
    let total = 0, tp = 0, tc = 0, tf = 0;
    currentPlan[dayIdx].slots.forEach(s => {
        const m = currentPlan[dayIdx].meals[s];
        if (m) { total += m.cal; tp += m.protein||0; tc += m.carbs||0; tf += m.fats||0; }
    });
    currentPlan[dayIdx].total = total;
    currentPlan[dayIdx].totalProtein = tp;
    currentPlan[dayIdx].totalCarbs = tc;
    currentPlan[dayIdx].totalFats = tf;

    closeSwapModal();
    renderDayContent(dayIdx);
    renderGroceryList();
    saveData();
}
window.closeSwapModal = function() { document.getElementById('swap-modal').classList.add('hidden'); };

function generateCookingInstructions(meal) {
    if (meal.recipe) return meal.recipe; // If explicitly provided

    const ings = meal.ing || [];
    let method = "Pan-fry / Sauté";
    const nameL = meal.name.toLowerCase();
    
    if (nameL.includes('grilled') || nameL.includes('bbq') || nameL.includes('tandoori')) method = "Grill / Roast";
    else if (nameL.includes('boil') || nameL.includes('soup') || nameL.includes('dal')) method = "Boil / Simmer";
    else if (nameL.includes('salad')) method = "Toss / Mix raw";
    else if (nameL.includes('baked') || nameL.includes('oven')) method = "Bake at 200°C";
    else if (nameL.includes('smoothie') || nameL.includes('shake')) method = "Blend";

    const proteins = ings.filter(i => GROCERY_CATS['Proteins'].some(p => i.toLowerCase().includes(p.toLowerCase())));
    const veggies = ings.filter(i => GROCERY_CATS['Vegetables'].some(p => i.toLowerCase().includes(p.toLowerCase())));
    const carbs = ings.filter(i => GROCERY_CATS['Grains & Carbs'].some(p => i.toLowerCase().includes(p.toLowerCase())));
    const spices = ings.filter(i => GROCERY_CATS['Spices & Condiments'].some(p => i.toLowerCase().includes(p.toLowerCase())));

    let steps = [];
    
    if (method === "Toss / Mix raw") {
        steps.push(`<b>1. Prep:</b> Wash and chop all fresh ingredients: ${ings.join(', ')}.`);
        steps.push(`<b>2. Mix:</b> In a large bowl, combine everything thoroughly.`);
        steps.push(`<b>3. Dress:</b> Add dressing or spices (${spices.length?spices.join(', '):'salt & pepper to taste'}) and toss evenly.`);
    } else if (method === "Blend") {
        steps.push(`<b>1. Prep:</b> Roughly chop ${ings.join(', ')} if necessary.`);
        steps.push(`<b>2. Blend:</b> Add all ingredients to a blender.`);
        steps.push(`<b>3. Texture:</b> Blend until smooth. Add water or ice to reach preferred consistency.`);
    } else {
        steps.push(`<b>1. Prep:</b> Wash and portion your ingredients. Marinate your primary protein (${proteins[0] || 'main ingredient'}) with ${spices.length?spices.join(', '):'your favorite spices'} if desired.`);
        
        if (carbs.length) {
            steps.push(`<b>2. Carbs:</b> Cook ${carbs.join(', ')} separately according to package instructions or until tender.`);
        }
        
        steps.push(`<b>3. Cook (${method}):</b> Heat a small amount of oil in a pan/pot over medium-high heat. Add your main ingredients and cook until fully done.`);
        
        if (veggies.length) {
            steps.push(`<b>4. Veggies:</b> Add ${veggies.join(', ')} during the last few minutes so they remain crisp and nutritious.`);
        }
        
        steps.push(`<b>5. Serve:</b> Plate everything together and enjoy your healthy ${meal.cal} kcal meal!`);
    }

    return steps.join('<br><br>');
}

// =========================================
// MEAL DETAIL TOAST
// =========================================
window.showMealToast = function(meal) {
    document.getElementById('toast-meal-name').textContent = meal.name;
    const macros = document.getElementById('toast-macros');
    macros.innerHTML = `
        <span class="toast-macro-pill" style="background:#10b981">${meal.cal} kcal</span>
        <span class="toast-macro-pill" style="background:#6366f1">${meal.protein||'?'}g Protein</span>
        <span class="toast-macro-pill" style="background:#f59e0b">${meal.carbs||'?'}g Carbs</span>
        <span class="toast-macro-pill" style="background:#ec4899">${meal.fats||'?'}g Fats</span>
    `;
    document.getElementById('toast-ingredients').innerHTML = `
        <strong style="color:var(--text-sub)">Ingredients:</strong><br>${(meal.ing || []).join(', ')}
    `;
    
    // Inject Dynamic Recipe
    const instructionsHtml = generateCookingInstructions(meal);
    document.getElementById('toast-instructions').innerHTML = `
        <strong style="color:var(--primary); font-size: 0.95rem;">🧑‍🍳 Smart Cooking Intructions:</strong><br><br>
        <div style="font-size: 0.85rem; line-height: 1.5; color: var(--text-main);">${instructionsHtml}</div>
    `;

    const toast = document.getElementById('nutrition-toast');
    toast.classList.remove('hidden');
};
window.closeToast = function() { document.getElementById('nutrition-toast').classList.add('hidden'); };

// =========================================
// GROCERY LIST
// =========================================
// NOTE: Order matters — Vegetables before Proteins prevents "Eggplant" → Proteins via "Egg"
const GROCERY_CATS = {
    'Vegetables': ['Eggplant','Bitter Melon','Bok Choy','Bell Peppers','Asparagus','Capsicum','Broccoli','Zucchini','Cucumber','Spinach','Mushrooms','Lettuce','Cabbage','Celery','Potato','Radish','Pumpkin','Okra','Beans','Carrot','Onion','Tomato','Garlic','Ginger','Papaya','Chayote','Kangkong','Spring Onion','Corn'],
    'Fruits': ['Banana','Mango','Apple','Berries','Mixed Berries','Cherry Tomatoes','Avocado','Lemon','Lime','Dates','Saba Banana','Calamansi','Coconut'],
    'Proteins': ['Chicken','Beef','Fish','Egg','Prawn','Salmon','Lamb','Tuna','Shrimp','Mutton','Turkey','Pork','Mackerel','Tilapia','Pearl Spot Fish','Smoked Salmon','Whey Protein','Bacon'],
    'Grains & Carbs': ['Matta Rice','Jasmine Rice','Brown Rice','Basmati Rice','Arborio Rice','Japanese Rice','Sticky Rice','Rice Flour','Wheat Flour','Maida Flour','Rice Noodles','Ramen Noodles','Rolled Oats','Semolina','Tortilla','Pita Bread','Rice','Flour','Bread','Batter','Noodles','Pasta','Oats','Quinoa'],
    'Dairy & Eggs': ['Greek Yogurt','Cream Cheese','Almond Milk','Evaporated Milk','Coconut Milk','Curd','Yogurt','Labneh','Paneer','Cheese','Cream','Ghee','Butter','Milk','Eggs'],
    'Legumes & Pulses': ['Chickpeas','Toor Dal','Moong Dal','Red Lentils','Black Lentils','Green Lentils','Kidney Beans','Mung Beans','Fava Beans','Black Chickpeas','Edamame','Green Moong Dal','Sprouts'],
    'Spices & Condiments': ['Mustard Seeds','Curry Leaves','Tandoori Masala','Tamarind','Coriander','Cardamom','Turmeric','Peppercorns','Bay Leaves','Shrimp Paste','Soy Sauce','Fish Sauce','Oyster Sauce','Chili Leaves','Thai Basil','Vinegar','Sumac','Za\'atar','Cumin','Pepper','Spices','Honey','Salt','Sugar','Cinnamon'],
    'Fats & Oils': ['Coconut Oil','Sesame Oil','Olive Oil','MCT Oil','Almond Butter','Peanut Butter','Tahini','Butter','Oil'],
    'Nuts & Seeds': ['Almonds','Walnuts','Cashews','Peanuts','Chia Seeds','Sesame Seeds','Mixed Nuts'],
    'Other': [],
};

function categorizeIngredient(ing) {
    const lower = ing.toLowerCase().trim();
    for (const [cat, keywords] of Object.entries(GROCERY_CATS)) {
        if (cat === 'Other') continue;
        // Check longest keywords first to avoid partial matches (e.g. 'Egg' inside 'Eggplant')
        const sorted = [...keywords].sort((a, b) => b.length - a.length);
        if (sorted.some(k => {
            const kl = k.toLowerCase();
            // Exact match OR ingredient starts/ends with keyword (word-boundary safe)
            return lower === kl ||
                   lower.startsWith(kl + ' ') ||
                   lower.endsWith(' ' + kl) ||
                   lower.includes(' ' + kl + ' ') ||
                   lower.includes(kl + ' ') && lower.indexOf(kl) === 0;
        })) return cat;
    }
    return 'Other';
}

function renderGroceryList() {
    const allIngredients = new Map();
    currentPlan.forEach(day => {
        Object.values(day.meals || {}).forEach(meal => {
            (meal?.ing || []).forEach(ing => {
                const key = ing.trim().toLowerCase();
                if (!allIngredients.has(key)) allIngredients.set(key, ing.trim());
            });
        });
    });

    const byCategory = {};
    allIngredients.forEach((original) => {
        const cat = categorizeIngredient(original);
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(original);
    });

    // Sort categories
    const orderedCats = Object.keys(GROCERY_CATS).filter(c => byCategory[c]?.length > 0);

    const container = document.getElementById('grocery-categories-container');
    container.innerHTML = '';
    let totalItems = 0, checkedItems = 0;

    orderedCats.forEach(cat => {
        const items = (byCategory[cat] || []).sort();
        if (!items.length) return;

        const catDiv = document.createElement('div');
        catDiv.className = 'grocery-category';
        catDiv.innerHTML = `<div class="grocery-cat-title">${cat}</div>`;
        const grid = document.createElement('div');
        grid.className = 'grocery-items-grid';

        items.forEach((item) => {
            totalItems++;
            const isChecked = !!groceryState[item.toLowerCase()];
            if (isChecked) checkedItems++;
            const li = document.createElement('div');
            li.className = 'grocery-item' + (isChecked ? ' checked' : '');
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = isChecked;
            cb.id = `gi-${item.replace(/\s/g,'_')}`;
            const lbl = document.createElement('label');
            lbl.textContent = item; lbl.htmlFor = cb.id;
            cb.addEventListener('change', function() {
                groceryState[item.toLowerCase()] = this.checked;
                li.classList.toggle('checked', this.checked);
                updateGroceryProgress();
                saveData();
            });
            li.appendChild(cb); li.appendChild(lbl);
            grid.appendChild(li);
        });

        catDiv.appendChild(grid);
        container.appendChild(catDiv);
    });

    updateGroceryProgress(totalItems, checkedItems);
    setupCopyGrocery(allIngredients);
}

function updateGroceryProgress(total, checked) {
    let t = total, c = checked;
    if (t === undefined) {
        // Recount
        t = document.querySelectorAll('.grocery-item').length;
        c = document.querySelectorAll('.grocery-item.checked').length;
    }
    document.getElementById('grocery-progress-text').textContent = `${c} / ${t} items checked`;
    const pct = t > 0 ? (c / t) * 100 : 0;
    document.getElementById('grocery-progress-fill').style.width = pct + '%';
}

window.clearAllGrocery = function() {
    groceryState = {};
    document.querySelectorAll('.grocery-item input[type=checkbox]').forEach(cb => { cb.checked = false; cb.closest('.grocery-item').classList.remove('checked'); });
    updateGroceryProgress();
    saveData();
};

function setupCopyGrocery(allIngredients) {
    document.getElementById('copy-grocery-btn').onclick = function() {
        let text = '🛒 NutriPro Shopping List\n\n';
        allIngredients.forEach((original) => {
            const checked = groceryState[original.toLowerCase()] ? '✅' : '☐';
            text += `${checked} ${original}\n`;
        });
        navigator.clipboard.writeText(text).then(() => {
            const btn = this; const orig = btn.textContent;
            btn.textContent = '✅ Copied!'; btn.disabled = true;
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
        });
    };
}

// =========================================
// PROFILE VIEW UPDATE
// =========================================
function updateProfileView(inputs) {
    if (!inputs) return;
    safeSet('pd-age', inputs.age);
    safeSet('pd-gender', capitalize(inputs.gender || '--'));
    safeSet('pd-height', (inputs.height || '--') + ' cm');
    safeSet('pd-weight', (inputs.weight || '--') + ' kg');
    safeSet('pd-goal', goalLabel(inputs.goalType));
    safeSet('pd-diet', capitalize((inputs.dietType || '--').replace(/-/g,' ')));
    safeSet('pd-cuisine', capitalize(inputs.cuisine || '--'));
    safeSet('pd-activity', activityLabel(inputs.activity));
}

function goalLabel(g) {
    const m = {loss:'⬇️ Weight Loss', gain:'⬆️ Weight Gain', maintain:'↔️ Maintain', recomp:'🔄 Body Recomp'};
    return m[g] || g || '--';
}
function activityLabel(a) {
    const m = {'1.2':'Sedentary','1.375':'Light','1.55':'Moderate','1.725':'Active','1.9':'Very Active'};
    return m[String(a)] || 'Moderate';
}

// =========================================
// ANALYTICS VIEW
// =========================================
function renderAnalytics() {
    if (!metricsData.targetCalories) return;
    destroyCharts();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#d1fae5' : '#374151';
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';

    // BMI Gauge
    const bmi = metricsData.bmi || 22;
    const bmiCtx = document.getElementById('bmi-gauge-chart').getContext('2d');
    const bmiPct = Math.min((bmi - 10) / 35, 1);
    const bmiCat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
    const gaugeColor = bmi < 18.5 ? '#60a5fa' : bmi < 25 ? '#10b981' : bmi < 30 ? '#f59e0b' : '#ef4444';
    charts.bmi = new Chart(bmiCtx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [bmiPct * 100, 100 - bmiPct * 100],
                backgroundColor: [gaugeColor, isDark ? 'rgba(255,255,255,0.06)' : '#e5e7eb'],
                borderWidth: 0, circumference: 180, rotation: 270
            }]
        },
        options: { responsive: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
    document.getElementById('gauge-bmi-value').textContent = bmi;
    document.getElementById('gauge-bmi-category').textContent = bmiCat;

    // Macro Donut
    const m = metricsData.macros || { protein: 150, carbs: 200, fats: 65 };
    const macroCtx = document.getElementById('macro-donut-chart').getContext('2d');
    charts.macro = new Chart(macroCtx, {
        type: 'doughnut',
        data: {
            labels: ['Protein', 'Carbs', 'Fats'],
            datasets: [{ data: [m.protein * 4, m.carbs * 4, m.fats * 9], backgroundColor: ['#6366f1', '#10b981', '#f59e0b'], borderWidth: 2, borderColor: isDark ? '#0a0f0e' : '#fff' }]
        },
        options: { responsive: false, cutout: '65%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => ` ${i.label}: ${i.raw} kcal` } } } }
    });
    const legendEl = document.getElementById('macro-legend');
    legendEl.innerHTML = [
        {label:'Protein', val: m.protein + 'g', color:'#6366f1'},
        {label:'Carbs', val: m.carbs + 'g', color:'#10b981'},
        {label:'Fats', val: m.fats + 'g', color:'#f59e0b'},
    ].map(x => `<div class="macro-legend-item"><div class="legend-dot" style="background:${x.color}"></div><span class="legend-label">${x.label}</span><span class="legend-value">${x.val}</span></div>`).join('');

    // Calorie breakdown
    safeSet('cb-bmr', metricsData.bmr + ' kcal');
    safeSet('cb-tdee', metricsData.tdee + ' kcal');
    safeSet('cb-target', metricsData.targetCalories + ' kcal');
    const diff = (metricsData.targetCalories || 0) - (metricsData.tdee || 0);
    const diffEl = document.getElementById('cb-deficit');
    if (diffEl) {
        diffEl.textContent = (diff >= 0 ? '+' : '') + diff + ' kcal';
        diffEl.style.color = diff > 0 ? '#f59e0b' : diff === 0 ? '#10b981' : '#6366f1';
    }

    // Body stats
    safeSet('bs-ideal', `${metricsData.idealWeightMin} – ${metricsData.idealWeightMax} kg`);
    safeSet('bs-bodyfat', (metricsData.bodyFat || '--') + '%');
    safeSet('bs-lbm', (metricsData.lbm || '--') + ' kg');
    const whr = metricsData.inputs?.height ? (0.45).toFixed(2) : '--';
    safeSet('bs-whr', whr);

    // Weekly Calorie Chart
    const wkCtx = document.getElementById('weekly-cal-chart').getContext('2d');
    const weeklyData = currentPlan.map(d => d.total);
    const targetLine = Array(7).fill(metricsData.targetCalories || 0);
    charts.weekly = new Chart(wkCtx, {
        type: 'bar',
        data: {
            labels: DAYS.map(d => d.substring(0,3)),
            datasets: [
                { label: 'Planned Calories', data: weeklyData, backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 8 },
                { label: 'Target', data: targetLine, type: 'line', borderColor: '#6366f1', borderDash: [5,4], borderWidth: 2, pointRadius: 0, fill: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor } }, tooltip: { mode: 'index' } },
            scales: {
                x: { ticks: { color: textColor }, grid: { color: gridColor } },
                y: { ticks: { color: textColor }, grid: { color: gridColor } }
            }
        }
    });

    // Nutrition Balance Bars
    const nutrients = [
        { label: 'Protein', val: m.protein, max: 200, color: '#6366f1', unit: 'g' },
        { label: 'Carbohydrates', val: m.carbs, max: 350, color: '#10b981', unit: 'g' },
        { label: 'Fats', val: m.fats, max: 100, color: '#f59e0b', unit: 'g' },
        { label: 'Water', val: +(metricsData.waterIntake||2), max: 4, color: '#06b6d4', unit: 'L' },
    ];
    const nbContainer = document.getElementById('nutrition-bars-container');
    nbContainer.innerHTML = '';
    nutrients.forEach(n => {
        const pct = Math.min((n.val / n.max) * 100, 100).toFixed(1);
        nbContainer.innerHTML += `
            <div class="nutrition-bar-row">
                <div class="nutr-label-row"><span class="nutr-label">${n.label}</span><span class="nutr-value">${n.val}${n.unit}</span></div>
                <div class="nutr-bar-track"><div class="nutr-bar-fill" style="width:${pct}%;background:${n.color};"></div></div>
            </div>`;
    });

    // Weight Progress Chart
    renderWeightChart(isDark, textColor, gridColor);
}

function renderWeightChart(isDark, textColor, gridColor) {
    const wCtx = document.getElementById('weight-progress-chart').getContext('2d');
    if (weightLog.length < 2) {
        // Show placeholder
        renderWeightLogList();
        return;
    }
    const sorted = [...weightLog].sort((a,b) => new Date(a.date)-new Date(b.date));
    charts.weight = new Chart(wCtx, {
        type: 'line',
        data: {
            labels: sorted.map(e => e.date),
            datasets: [{
                label: 'Weight (kg)', data: sorted.map(e => e.weight),
                borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)',
                tension: 0.4, fill: true, pointBackgroundColor: '#10b981', pointRadius: 5
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor } } },
            scales: {
                x: { ticks: { color: textColor }, grid: { color: gridColor } },
                y: { ticks: { color: textColor }, grid: { color: gridColor } }
            }
        }
    });
    renderWeightLogList();
}

function renderWeightLogList() {
    const el = document.getElementById('weight-log-list');
    if (!el) return;
    if (!weightLog.length) { el.innerHTML = '<p class="empty-state">No weigh-ins logged yet. Start tracking!</p>'; return; }
    const sorted = [...weightLog].sort((a,b) => new Date(b.date)-new Date(a.date));
    el.innerHTML = sorted.slice(0,5).map(e => `
        <div class="weight-log-entry">
            <span class="weight-log-date">${e.date}</span>
            <span class="weight-log-value">${e.weight} kg</span>
        </div>
    `).join('');
}

function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
    charts = {};
}

// =========================================
// WEIGHT LOG MODAL
// =========================================
window.showAddWeightModal = function() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('log-date-input').value = today;
    document.getElementById('new-weight-input').value = '';
    document.getElementById('weight-modal').classList.remove('hidden');
};
window.closeWeightModal = function() { document.getElementById('weight-modal').classList.add('hidden'); };
window.saveWeightLog = function() {
    const w = parseFloat(document.getElementById('new-weight-input').value);
    const d = document.getElementById('log-date-input').value;
    if (!w || !d) { showError('Please enter weight and date.'); return; }
    weightLog.push({ weight: w, date: d });
    closeWeightModal();
    renderWeightChart(
        document.documentElement.getAttribute('data-theme') === 'dark',
        '',''
    );
    renderWeightLogList();
    saveData();
    // Check achievement
    if (weightLog.length >= 5) unlockAchievement('ach-5weigh');
};

// =========================================
// ACHIEVEMENTS
// =========================================
function unlockAchievement(id) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('locked')) {
        el.classList.remove('locked');
        el.style.animation = 'pulseGlow 0.6s ease 3';
    }
}

// =========================================
// SAVE / LOAD DATA
// =========================================
function saveData() {
    if (!currentUser) return;
    const key = 'nutripro_plan_' + (currentUser.id || 'guest');
    const payload = {
        plan: currentPlan, groceryState, weightLog, metrics: metricsData,
        inputs: metricsData.inputs, selectedMealCount,
        savedAt: new Date().toISOString()
    };
    localStorage.setItem(key, JSON.stringify(payload));

    // Also save to API if not local
    if (currentUser.id && !String(currentUser.id).startsWith('local_')) {
        const apiPayload = {
            targetCalories: metricsData.targetCalories,
            waterIntake: metricsData.waterIntake,
            bmi: metricsData.bmi,
            inputs: metricsData.inputs,
            plan: currentPlan,
            groceryState,
            weightLog
        };
        fetch('api/save_plan.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id, plan_data: apiPayload })
        }).catch(() => {});
    }
}

// =========================================
// UTILITY FUNCTIONS
// =========================================
function safeSet(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
function capitalize(s) {
    if (!s) return '--';
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function showError(msg) {
    alert(msg);
}

// =========================================
// INIT COMPLETE — First-time achievements
// =========================================
(function() {
    const savedUser = localStorage.getItem('nutripro_user');
    if (savedUser) {
        const plan = localStorage.getItem('nutripro_plan_' + (JSON.parse(savedUser).id || 'guest'));
        if (plan) {
            setTimeout(() => unlockAchievement('ach-firstplan'), 1000);
        }
    }
})();

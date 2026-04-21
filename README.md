# 🥗 NutriPro — Advanced Diet Intelligence

NutriPro is a comprehensive, frontend-first diet and nutrition intelligence web application. It automates complex nutritional mathematics (Mifflin-St Jeor), dynamically generates 7-day personalized meal plans across multiple cuisines, and provides a smart analytical dashboard to track macros and weight progress.

## ✨ Features

- **🪄 Smart Diet Wizard:** A sleek multi-step form considering age, gender, height, current/target weights, health conditions (e.g., PCOS, Diabetes), and dietary preferences (e.g., Keto, Vegan).
- **🧮 Macro & Calorie Engine:** Automatically calculates Basal Metabolic Rate (BMR), Total Daily Energy Expenditure (TDEE), and adjusts target calories dynamically based on goals (maintenance, deficit, surplus).
- **🍽️ 200+ Meal Database Engine:** Selects from an expansive database spanning diverse cuisines, sorting by macros to match the user perfectly. 
- **🧑‍🍳 Dynamic Recipe Generator:** Uses an advanced smart-parsing script to read a meal's raw ingredients and dynamically write correct step-by-step cooking instructions (e.g., identifying whether to grill, boil, blend, or bake).
- **🛒 Smart Grocery List:** Automatically compiles a unified shopping list categorized logically (Proteins, Vegetables, Spices, Dairy) completely synced with progress checklists.
- **📊 Interactive Analytics Dashboard:** Integrates **Chart.js** for visual BMI gauges, weekly macro breakdown donuts, and weight progress line charts.
- **📱 Premium "Glassmorphism" UI:** A highly responsive CSS design system that natively supports both Light mode and sleek Dark mode.
- **💾 Offline-First Architecture:** Keeps data seamlessly cached in local storage for maximum speed, designed to gracefully sync with a RESTful PHP API backend when available.

## 🛠️ Technology Stack

- **Frontend:** HTML5, Vanilla JavaScript, Custom CSS Variables (Glassmorphism)
- **Data Visualization:** [Chart.js](https://www.chartjs.org/) via CDN
- **State Management:** Custom JS state synchronized with Web `localStorage`
- **Backend Ready:** Built to interface with optional PHP (`api/`) server scripts and a MySQL database.

## 🚀 Live Demo

Check out the live deployment of the application here:  
👉 **[Click Here to view the Live Site](https://annzmaria.github.io/YOUR-REPOSITORY-NAME/)**  
*(Note: Replace `YOUR-REPOSITORY-NAME` with your actual GitHub repository name!)*

## 💻 Local Installation

If you would like to run this application locally connected to a PHP environment:

1. Requires [XAMPP](https://www.apachefriends.org/index.html) (or similar Apache/PHP stack).
2. Clone this repository into your `htdocs` folder:
   ```bash
   cd xampp/htdocs/
   git clone https://github.com/annzmaria/YOUR-REPOSITORY-NAME.git
   ```
3. Open `http://localhost/YOUR-REPOSITORY-NAME/` in your browser.

## 👨‍💻 Development Highlight: Algorithmic Recipe Builder
Instead of manually typing cooking instructions for over 200 meals, this app utilizes a custom JavaScript parser that cross-references meal ingredients against a categorized index, calculates the required cooking method mathematically based on keywords, and generates a dynamic 5-step cooking recipe automatically at runtime!

***
*Developed intelligently for optimal UI/UX and health analytics.*

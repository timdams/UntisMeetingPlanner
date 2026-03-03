import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/MeetingPlanner2026/', // Voeg dit toe
  server: {
    port: 3000,
  },
});

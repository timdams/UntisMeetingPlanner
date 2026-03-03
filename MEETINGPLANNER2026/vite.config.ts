import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/UntisMeetingPlanner/', // Zorg dat dit overeenkomt met je repository naam
  server: {
    port: 3000,
  },
});

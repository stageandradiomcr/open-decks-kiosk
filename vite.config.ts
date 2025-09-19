<<<<<<< HEAD
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
=======
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

>>>>>>> 5c38c9d (Initial commit: Stage & Radio Open Decks kiosk)
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
<<<<<<< HEAD
      '@': path.resolve(__dirname, 'src')
    }
  }
})
=======
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
>>>>>>> 5c38c9d (Initial commit: Stage & Radio Open Decks kiosk)

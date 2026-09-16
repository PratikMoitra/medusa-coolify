import { loadEnv, defineConfig } from "@medusajs/framework/utils";

loadEnv(process.env.NODE_ENV || "production", process.cwd());

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    workerMode: (process.env.MEDUSA_WORKER_MODE || "shared") as "shared" | "worker" | "server",
    // Fix: Medusa hardcodes secure:true in production, but Coolify/Cloudflare
    // terminates SSL at the proxy level. Override cookie options so the
    // session cookie is set correctly behind the reverse proxy.
    cookieOptions: {
      secure: false,
      sameSite: "lax" as any,
    },
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
    // Disable SSL for Docker internal postgres (Coolify internal network)
    // ssl:false at the top level is the correct Medusa v2 databaseDriverOptions format
    databaseDriverOptions: process.env.DATABASE_SSL === "false" ? {
      ssl: false,
    } : undefined,
  },

  admin: {
    disable: process.env.DISABLE_ADMIN === "true" || process.env.MEDUSA_WORKER_MODE === "worker",
    backendUrl: process.env.BACKEND_URL || process.env.MEDUSA_BACKEND_URL,
  },

  modules: [
    // Redis-backed cache
    {
      resolve: "@medusajs/medusa/cache-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    // Redis-backed event bus
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    // Redis-backed workflow engine
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          url: process.env.REDIS_URL,
        },
      },
    },
    // Redis-backed locking
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            id: "locking-redis",
            resolve: "@medusajs/medusa/locking-redis",
            is_default: true,
            options: { redisUrl: process.env.REDIS_URL },
          },
        ],
      },
    },
    // Razorpay payment provider (Medusa v2 compatible)
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@alchemilla/medusa-razorpay/providers/payment-razorpay/src",
            id: "razorpay",
            options: {
              key_id: process.env.RAZORPAY_ID || "",
              key_secret: process.env.RAZORPAY_SECRET || "",
              razorpay_account: process.env.RAZORPAY_ACCOUNT || "",
              webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
              // auto_capture: true — Razorpay captures immediately on payment success.
              // This prevents the race condition where Medusa checks order status
              // before the payment webhook arrives (order still in "created" state),
              // which caused the "Payment authorization failed" storefront error.
              auto_capture: true,
              automatic_expiry_period: 20,
              refund_speed: "normal",
            },
          },
        ],
      },
    },
    // File storage: Cloudflare R2 (S3-compatible)
    ...(process.env.R2_ENDPOINT ? [{
      key: "file",
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-s3",
            id: "s3",
            options: {
              file_url: process.env.R2_PUBLIC_URL,
              access_key_id: process.env.R2_ACCESS_KEY_ID,
              secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
              region: "auto",
              bucket: process.env.R2_BUCKET || "medusa-media",
              endpoint: process.env.R2_ENDPOINT,
              additional_client_config: {
                forcePathStyle: true,
              },
            },
          },
        ],
      },
    }] : []),
    // Shiprocket fulfillment provider (only loaded when credentials are set)
    ...(process.env.SHIPROCKET_EMAIL ? [{
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "@sam-ael/medusa-plugin-shiprocket",
            id: "shiprocket",
            options: {
              email: process.env.SHIPROCKET_EMAIL,
              password: process.env.SHIPROCKET_PASSWORD,
              pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",
              cod: "false",
            },
          },
        ],
      },
    }] : []),
    // Google OAuth auth provider (for storefront customer login)
    ...(process.env.GOOGLE_CLIENT_ID ? [{
      resolve: "@medusajs/medusa/auth",
      options: {
        providers: [
          {
            resolve: "@medusajs/auth-google",
            id: "google",
            options: {
              clientID: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              callbackURL: process.env.GOOGLE_CALLBACK_URL || `${process.env.BACKEND_URL}/auth/customer/google/callback`,
            },
          },
        ],
      },
    }] : []),
  ],

  // Plugins (admin UI extensions + webhook routes)
  plugins: [
    // Shiprocket admin widget (tracking, labels, manifests, pickup scheduling)
    ...(process.env.SHIPROCKET_EMAIL ? [{
      resolve: "@sam-ael/medusa-plugin-shiprocket",
      options: {},
    }] : []),
  ],
});

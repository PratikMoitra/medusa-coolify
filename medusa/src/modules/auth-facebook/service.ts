import crypto from "crypto"
import {
  AbstractAuthModuleProvider,
  MedusaError,
} from "@medusajs/framework/utils"

/**
 * Facebook OAuth2 auth provider for MedusaJS v2.
 *
 * Follows the same pattern as @medusajs/auth-google:
 * 1. authenticate() → redirects to Facebook consent screen
 * 2. validateCallback() → exchanges auth code for access_token, fetches profile
 * 3. verify_() → creates or retrieves an AuthIdentity for the Facebook user
 *
 * Instagram Login uses the same Facebook OAuth infrastructure (Meta unified login).
 */

interface FacebookAuthConfig {
  clientID: string
  clientSecret: string
  callbackURL: string
}

interface FacebookProfile {
  id: string
  name?: string
  email?: string
  first_name?: string
  last_name?: string
  picture?: { data?: { url?: string } }
}

class FacebookAuthService extends AbstractAuthModuleProvider {
  static identifier = "facebook"
  static DISPLAY_NAME = "Facebook Authentication"

  private config_: FacebookAuthConfig
  private logger_: any

  static validateOptions(options: FacebookAuthConfig) {
    if (!options.clientID) {
      throw new Error("Facebook clientID is required")
    }
    if (!options.clientSecret) {
      throw new Error("Facebook clientSecret is required")
    }
    if (!options.callbackURL) {
      throw new Error("Facebook callbackURL is required")
    }
  }

  constructor({ logger }: { logger: any }, options: FacebookAuthConfig) {
    // @ts-ignore
    super(...arguments)
    this.config_ = options
    this.logger_ = logger
  }

  async register(_: any) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Facebook does not support registration. Use method `authenticate` instead."
    )
  }

  async authenticate(req: any, authIdentityService: any) {
    const query = req.query ?? {}
    const body = req.body ?? {}

    if (query.error) {
      return {
        success: false,
        error: `${query.error_description || query.error}`,
      }
    }

    const stateKey = crypto.randomBytes(32).toString("hex")
    const state = {
      callback_url: body?.callback_url ?? this.config_.callbackURL,
    }

    await authIdentityService.setState(stateKey, state)

    return this.getRedirect(
      this.config_.clientID,
      state.callback_url,
      stateKey
    )
  }

  async validateCallback(req: any, authIdentityService: any) {
    const query = req.query ?? {}
    const body = req.body ?? {}

    if (query.error) {
      return {
        success: false,
        error: `${query.error_description || query.error}`,
      }
    }

    const code = query?.code ?? body?.code
    if (!code) {
      return { success: false, error: "No code provided" }
    }

    const state = await authIdentityService.getState(query?.state)
    if (!state) {
      return {
        success: false,
        error: "No state provided, or session expired",
      }
    }

    try {
      // Exchange code for access_token
      const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token")
      tokenUrl.searchParams.set("client_id", this.config_.clientID)
      tokenUrl.searchParams.set("client_secret", this.config_.clientSecret)
      tokenUrl.searchParams.set("code", code)
      tokenUrl.searchParams.set("redirect_uri", state.callback_url)

      const tokenResponse = await fetch(tokenUrl.toString()).then((r) => {
        if (!r.ok) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Could not exchange token, ${r.status}, ${r.statusText}`
          )
        }
        return r.json()
      })

      const accessToken = tokenResponse.access_token
      if (!accessToken) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "No access_token in Facebook response"
        )
      }

      // Fetch user profile
      const profileUrl = new URL("https://graph.facebook.com/v19.0/me")
      profileUrl.searchParams.set("fields", "id,name,email,first_name,last_name,picture")
      profileUrl.searchParams.set("access_token", accessToken)

      const profile: FacebookProfile = await fetch(profileUrl.toString()).then((r) => {
        if (!r.ok) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Could not fetch Facebook profile, ${r.status}`
          )
        }
        return r.json()
      })

      const { authIdentity, success } = await this.verify_(
        profile,
        authIdentityService
      )

      return { success, authIdentity }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private async verify_(profile: FacebookProfile, authIdentityService: any) {
    if (!profile.id) {
      return { success: false, error: "No Facebook user ID found" }
    }

    const entity_id = profile.id
    const userMetadata = {
      name: profile.name,
      email: profile.email,
      picture: profile.picture?.data?.url,
      given_name: profile.first_name,
      family_name: profile.last_name,
    }

    let authIdentity: any

    try {
      authIdentity = await authIdentityService.retrieve({ entity_id })
    } catch (error: any) {
      if (error.type === MedusaError.Types.NOT_FOUND) {
        const createdAuthIdentity = await authIdentityService.create({
          entity_id,
          user_metadata: userMetadata,
        })
        authIdentity = createdAuthIdentity
      } else {
        return { success: false, error: error.message }
      }
    }

    return { success: true, authIdentity }
  }

  private getRedirect(clientId: string, callbackUrl: string, stateKey: string) {
    const authUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth")
    authUrl.searchParams.set("client_id", clientId)
    authUrl.searchParams.set("redirect_uri", callbackUrl)
    authUrl.searchParams.set("state", stateKey)
    authUrl.searchParams.set("scope", "email,public_profile")
    authUrl.searchParams.set("response_type", "code")

    return { success: true, location: authUrl.toString() }
  }
}

export default FacebookAuthService

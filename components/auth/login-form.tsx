"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LogIn, Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, ArrowLeft, CheckCircle2, Sparkles, KeyRound } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

interface LoginFormProps {
  onSuccess: () => void
  onRegisterClick: () => void
  onPersonalRegisterClick: () => void
  initialError?: string | null
}

type LoginStep = "email" | "password" | "google" | "personal-invite"

export default function LoginForm({ onSuccess, onRegisterClick, onPersonalRegisterClick, initialError }: LoginFormProps) {
  const [step, setStep] = useState<LoginStep>("email")
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    rememberMe: false,
  })

  const [error, setError] = useState<string | null>(initialError || null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [userType, setUserType] = useState<string | null>(null)

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("")
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false)
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false)
  const [forgotPasswordError, setForgotPasswordError] = useState<string | null>(null)

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.email) {
      setError("Please enter your email address")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email }),
      })

      const data = await response.json()

      if (data.exists && data.hasPassword) {
        // User exists and has a password -> Show password field
        setUserType(data.accountType) // Store account type ('business' | 'personal')
        setStep("password")
      } else if (data.exists && !data.hasPassword) {
        // Account exists but no password (Google OAuth account)
        if (formData.email.toLowerCase().endsWith('@gmail.com')) {
          setStep("google")
        } else {
          setError(`This account was created with Google. Please use "Sign in with Google" instead.`)
        }
      } else {
        // User doesn't exist -> Suggest Google Login or registration
        if (formData.email.toLowerCase().endsWith('@gmail.com')) {
          setStep("google")
        } else {
          setStep("personal-invite")
        }
      }
    } catch (err) {
      console.error("Error checking email:", err)
      setError("Failed to verify email. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.password) {
      setError("Please enter your password")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email.toLowerCase().trim(),
          password: formData.password,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "Login failed")
        return
      }

      // Success - cookies are set by the API
      if (typeof window !== "undefined" && data.user) {
        sessionStorage.setItem("current_user_id", data.user.id)
        sessionStorage.setItem("current_user_name", data.user.name)
        sessionStorage.setItem("current_user_role", data.user.role)
        sessionStorage.setItem("current_user_email", data.user.email)
        if (data.business) {
          sessionStorage.setItem("business_id", data.business.id)
          sessionStorage.setItem("business_name", data.business.name)
        }
      }

      onSuccess()
    } catch (error) {
      console.error("Login error:", error)
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/auth/gmail')

      if (!response.ok) {
        throw new Error('Failed to get auth URL')
      }

      const { authUrl } = await response.json()
      window.location.href = authUrl
    } catch (error) {
      console.error('Error connecting Gmail:', error)
      setError('Failed to connect Gmail. Please try again.')
      setLoading(false)
    }
  }

  const handleBack = () => {
    setStep("email")
    setError(null)
    setFormData(prev => ({ ...prev, password: "" }))
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!forgotPasswordEmail) {
      setForgotPasswordError("Please enter your email address")
      return
    }

    setForgotPasswordLoading(true)
    setForgotPasswordError(null)

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotPasswordEmail }),
      })

      const data = await response.json()

      if (!response.ok) {
        setForgotPasswordError(data.error || "Failed to send reset email")
        return
      }

      setForgotPasswordSent(true)
    } catch (err) {
      console.error("Forgot password error:", err)
      setForgotPasswordError("An unexpected error occurred. Please try again.")
    } finally {
      setForgotPasswordLoading(false)
    }
  }

  const openForgotPasswordDialog = () => {
    setForgotPasswordEmail(formData.email || "")
    setForgotPasswordSent(false)
    setForgotPasswordError(null)
    setShowForgotPassword(true)
  }

  return (
    <div className="w-full max-w-6xl mx-auto grid lg:grid-cols-2 gap-8 items-center min-h-screen p-4">
      {/* Left side - Marketing content */}
      <div className="hidden lg:flex flex-col justify-center space-y-8 px-8">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-sm font-semibold">
            <ShieldCheck className="w-4 h-4" />
            Secure & Encrypted
          </div>
          <h1 className="text-5xl font-bold leading-tight">
            Welcome Back to
            <br />
            <span className="bg-gradient-to-r from-primary via-purple-500 to-pink-500 bg-clip-text text-transparent">
              Smart Email Support
            </span>
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed">
            Sign in to continue managing your customer conversations with AI-powered assistance.
          </p>
        </div>


      </div>

      {/* Right side - Login form */}
      <Card className="w-full shadow-2xl border-border/60 backdrop-blur-sm relative overflow-hidden">
        <CardHeader className="space-y-2 pb-6">
          <div className="flex justify-center lg:hidden">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg">
              <LogIn className="w-8 h-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold text-center">Sign In</CardTitle>
          <CardDescription className="text-center text-base">
            {step === "email" && "Welcome back! Please enter your email."}
            {step === "password" && `Hello again! Enter your password.`}
            {step === "google" && "Connect with your email provider."}
            {step === "personal-invite" && "Create your personal account."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-6 animate-in slide-in-from-top-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === "email" && (
            <form onSubmit={handleEmailSubmit} className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="h-11 pl-10"
                    disabled={loading}
                    required
                    autoComplete="email"
                    autoFocus
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold group"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    Checking...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>

              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/50" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleLogin}
                className="w-full h-12 text-base font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors"
                disabled={loading}
              >
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google
              </Button>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                  <Mail className="w-3 h-3" />
                  {formData.email}
                </div>
                <button
                  type="button"
                  onClick={handleBack}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Change
                </button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="h-11 pl-10 pr-10"
                    disabled={loading}
                    required
                    autoComplete="current-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    disabled={loading}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="rememberMe"
                    checked={formData.rememberMe}
                    onCheckedChange={(checked) => setFormData({ ...formData, rememberMe: checked as boolean })}
                    disabled={loading}
                  />
                  <Label htmlFor="rememberMe" className="text-sm font-normal cursor-pointer">
                    Remember me
                  </Label>
                </div>
                <button
                  type="button"
                  className="text-sm text-primary hover:underline font-medium"
                  disabled={loading}
                  onClick={openForgotPasswordDialog}
                >
                  Forgot password?
                </button>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  className="h-12 w-12 px-0 flex-shrink-0"
                  disabled={loading}
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-12 text-base font-semibold group"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      Signing In...
                    </>
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}

          {step === "google" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-8 h-8 text-blue-500" />
                </div>
                <h3 className="text-lg font-semibold">Continue with Google</h3>
                <p className="text-sm text-muted-foreground">
                  We couldn't find a business account for <span className="font-medium text-foreground">{formData.email}</span>.
                  <br />
                  Would you like to sign in with Google instead?
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={handleGoogleLogin}
                  className="w-full h-12 text-base font-semibold bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin mr-2" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                        <path
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          fill="#4285F4"
                        />
                        <path
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          fill="#34A853"
                        />
                        <path
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          fill="#FBBC05"
                        />
                        <path
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          fill="#EA4335"
                        />
                      </svg>
                      Sign in with Google
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleBack}
                  className="w-full"
                  disabled={loading}
                >
                  Use a different email
                </Button>
              </div>
            </div>
          )}

          {step === "personal-invite" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-purple-500" />
                </div>
                <h3 className="text-lg font-semibold">No account found</h3>
                <p className="text-sm text-muted-foreground">
                  We couldn't find an account for <span className="font-medium text-foreground">{formData.email}</span>.
                  <br />
                  Would you like to create a free personal account?
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={onPersonalRegisterClick}
                  className="w-full h-12 text-base font-semibold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-sm"
                >
                  Create Personal Account
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleBack}
                  className="w-full"
                >
                  Use a different email
                </Button>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="relative py-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Don't have an account?</span>
            </div>
          </div>

          {/* Register Link */}
          <Button
            type="button"
            variant="outline"
            onClick={onRegisterClick}
            className="w-full h-11 font-medium"
            disabled={loading}
          >
            Create Business Account
          </Button>
        </CardContent>
      </Card>

      {/* Forgot Password Dialog */}
      <Dialog open={showForgotPassword} onOpenChange={setShowForgotPassword}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
                <KeyRound className="w-6 h-6 text-white" />
              </div>
            </div>
            <DialogTitle className="text-center">Reset Password</DialogTitle>
            <DialogDescription className="text-center">
              {forgotPasswordSent
                ? "Check your email for a reset link"
                : "Enter your email and we'll send you a reset link"}
            </DialogDescription>
          </DialogHeader>

          {forgotPasswordSent ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="font-medium text-foreground">{forgotPasswordEmail}</span>, you will receive a password reset link shortly.
              </p>
              <Button
                onClick={() => setShowForgotPassword(false)}
                className="w-full"
              >
                Close
              </Button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              {forgotPasswordError && (
                <Alert variant="destructive">
                  <AlertDescription>{forgotPasswordError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="forgot-email"
                    type="email"
                    placeholder="name@company.com"
                    value={forgotPasswordEmail}
                    onChange={(e) => setForgotPasswordEmail(e.target.value)}
                    className="pl-10"
                    disabled={forgotPasswordLoading}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={forgotPasswordLoading}
              >
                {forgotPasswordLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    Sending...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

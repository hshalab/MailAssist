"use client"

import { useState, useEffect, Suspense } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Sparkles,
  Mail,
  Users,
  BarChart3,
  Zap,
  Shield,
  CheckCircle2,
  ArrowRight,
  Building2
} from "lucide-react"
import BusinessRegistrationForm from "@/components/auth/business-registration-form"
import LoginForm from "@/components/auth/login-form"
import OTPVerification from "@/components/auth/otp-verification"
import PersonalRegistrationForm from "@/components/auth/personal-registration-form"
import { useRouter, useSearchParams } from "next/navigation"

type ViewType = "landing" | "login" | "register" | "verify-otp" | "register-personal"

export default function AuthLandingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <AuthLandingContent />
    </Suspense>
  )
}

function AuthLandingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Start with null to show loading state while parsing URL
  const [currentView, setCurrentView] = useState<ViewType | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // Initialize view from URL params on mount
  useEffect(() => {
    const view = searchParams.get('view')
    if (view === 'login' || view === 'register' || view === 'register-personal' || view === 'verify-otp') {
      setCurrentView(view as ViewType)
    } else {
      setCurrentView('landing')
    }
    setIsInitialized(true)
  }, [searchParams])

  const [verificationData, setVerificationData] = useState<{
    email: string
    verificationToken: string
    businessId: string
  } | null>(null)

  // Show loading state until initialized
  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const handleRegistrationSuccess = (data: {
    email: string
    verificationToken: string
    businessId: string
  }) => {
    setVerificationData(data)
    setCurrentView("verify-otp")
  }

  const handleLoginSuccess = () => {
    // After business auth login, redirect to main tool
    router.push("/")
  }

  const handleOTPSuccess = () => {
    // After business registration + OTP verification, redirect to main app
    router.push("/")
  }

  const handlePersonalRegistrationSuccess = () => {
    // After personal registration, redirect to main app
    router.push("/")
  }

  // Landing Page View
  if (currentView === "landing") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
        {/* Animated background gradients */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
        <div className="relative z-10">
          <div className="w-full max-w-7xl">
            {/* Hero Section */}
            <div className="text-center space-y-6 mb-12">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/20 border border-primary/30 text-primary text-sm font-semibold backdrop-blur-xl shadow-lg shadow-primary/10">
                <Sparkles className="w-4 h-4 animate-pulse" />
                AI-Powered Email Support Platform
              </div>

              <h1 className="text-5xl md:text-6xl font-bold leading-tight">
                <span className="text-white">Transform Your</span>
                <br />
                <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Customer Support
                </span>
              </h1>

              <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto">
                Manage customer emails with AI-powered drafts, team collaboration, and smart automation.
                Start your free trial today.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
                <Button
                  size="lg"
                  onClick={() => setCurrentView("register")}
                  className="h-14 px-8 text-lg font-semibold group shadow-lg hover:shadow-xl transition-all hover:scale-105 bg-gradient-to-r from-primary via-purple-500 to-pink-500"
                >
                  Get Started Free
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setCurrentView("login")}
                  className="h-14 px-8 text-lg font-semibold hover:scale-105 transition-all border-white/20 text-white hover:bg-white/10"
                >
                  Sign In
                </Button>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => setCurrentView("register-personal")}
                  className="text-sm text-slate-400 hover:text-white hover:underline transition-colors"
                >
                  Looking for personal use? Create a free personal account
                </button>
              </div>
            </div>

            {/* Features Grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mt-16">
              {[
                {
                  icon: Sparkles,
                  title: "AI-Generated Responses",
                  description: "Let AI draft professional email responses based on your tone and style",
                  color: "from-blue-500 to-cyan-500"
                },
                {
                  icon: Users,
                  title: "Team Collaboration",
                  description: "Invite agents, assign roles, and manage permissions across your team",
                  color: "from-purple-500 to-pink-500"
                },
                {
                  icon: Mail,
                  title: "Multi-Email Support",
                  description: "Connect multiple email accounts from Gmail, Outlook, and more",
                  color: "from-green-500 to-emerald-500"
                },
                {
                  icon: BarChart3,
                  title: "Analytics & Insights",
                  description: "Track response times, team performance, and customer satisfaction",
                  color: "from-orange-500 to-red-500"
                },
                {
                  icon: Shield,
                  title: "Smart Guardrails",
                  description: "Set content filters and approval workflows to maintain quality",
                  color: "from-indigo-500 to-purple-500"
                },
                {
                  icon: Zap,
                  title: "Quick Replies",
                  description: "Create and share templates for common customer questions",
                  color: "from-yellow-500 to-orange-500"
                }
              ].map((feature, index) => (
                <Card key={index} className="relative group border-slate-700/50 bg-slate-900/50 backdrop-blur-xl hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10 transition-all duration-300 hover:scale-105">
                  <CardHeader>
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-lg`}>
                      <feature.icon className="w-6 h-6 text-white" />
                    </div>
                    <CardTitle className="text-xl text-white">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base text-slate-400">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>


          </div>
        </div>
      </div>
    )
  }

  // Login View
  if (currentView === "login") {
    const errorParam = searchParams.get('error')
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 animate-in fade-in duration-300">
        <LoginForm
          onSuccess={handleLoginSuccess}
          onRegisterClick={() => setCurrentView("register")}
          onPersonalRegisterClick={() => setCurrentView("register-personal")}
          initialError={errorParam}
        />
      </div>
    )
  }

  // Registration View
  if (currentView === "register") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 animate-in fade-in duration-300">
        <BusinessRegistrationForm
          onSuccess={handleRegistrationSuccess}
          onLoginClick={() => setCurrentView("login")}
        />
      </div>
    )
  }

  // Personal Registration View
  if (currentView === "register-personal") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 animate-in fade-in duration-300">
        <PersonalRegistrationForm
          onSuccess={handlePersonalRegistrationSuccess}
          onLoginClick={() => setCurrentView("login")}
        />
      </div>
    )
  }

  // OTP Verification View
  if (currentView === "verify-otp" && verificationData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 animate-in fade-in duration-300">
        <OTPVerification
          email={verificationData.email}
          verificationToken={verificationData.verificationToken}
          businessId={verificationData.businessId}
          onSuccess={handleOTPSuccess}
          onBack={() => setCurrentView("register")}
        />
      </div>
    )
  }

  return null
}

"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Logo from "@/components/logo"
import {
  Building2,
  User,
  Mail,
  Users,
  Shield,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Zap,
  BarChart3,
  Clock,
  Star,
  TrendingUp,
  Lock
} from "lucide-react"

export default function WelcomePage() {
  const [connecting, setConnecting] = useState(false)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)

  const handleGmailConnect = async () => {
    try {
      setConnecting(true)
      // Set flag to show loading skeleton when returning from OAuth
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('show_inbox_skeleton_on_return', 'true')
      }
      
      const response = await fetch('/api/auth/gmail')

      if (!response.ok) {
        throw new Error('Failed to get auth URL')
      }

      const { authUrl } = await response.json()
      window.location.href = authUrl
    } catch (error) {
      console.error('Error connecting Gmail:', error)
      alert('Failed to connect Gmail. Please try again.')
      setConnecting(false)
      // Clear flag on error
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('show_inbox_skeleton_on_return')
      }
    }
  }

  const handleBusinessSignup = () => {
    window.location.href = '/auth/landing'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
      {/* Animated background gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/40 backdrop-blur-md transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 group cursor-pointer transition-transform hover:scale-105 active:scale-95" onClick={() => window.location.reload()}>
              <Logo size="default" showText={true} />
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => window.location.href = '/auth/landing?view=login'}
                  className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 h-10 px-6 text-sm font-bold rounded-full transition-all hover:scale-105 active:scale-95 border-0"
                >
                  Sign In
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        <div className="text-center space-y-8 mb-16">
          <div className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-gradient-to-r from-primary/20 to-purple-500/20 border border-primary/30 text-primary text-sm font-semibold backdrop-blur-xl shadow-lg shadow-primary/20">
            <Sparkles className="w-4 h-4 animate-pulse" />
            AI-Powered Email Assistant
          </div>

          <h1 className="text-5xl md:text-7xl font-bold leading-tight tracking-tight">
            <span className="text-white">Write Emails That</span>
            <br />
            <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent animate-gradient">
              Sound Like You
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-slate-300 max-w-3xl mx-auto leading-relaxed">
            AI learns your writing style and generates personalized email drafts.
            <br />
            <span className="text-white font-semibold">Perfect for individuals and teams.</span>
          </p>
        </div>

        {/* Two Path Options */}
        <div className="grid lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
          {/* Personal Use Card */}
          <div
            className="group relative overflow-hidden rounded-3xl p-0.5"
            onMouseEnter={() => setHoveredCard('personal')}
            onMouseLeave={() => setHoveredCard(null)}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
            <Card className="relative h-full bg-slate-900/90 border-slate-700/50 backdrop-blur-xl hover:border-blue-500/50 transition-all duration-500 overflow-visible flex flex-col">
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

              <div className="absolute top-3 left-6 z-10">
                <div className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-bold rounded-full shadow-lg">
                  <Clock className="w-3 h-3" />
                  QUICKSTART
                </div>
              </div>

              <CardHeader className="space-y-6 pt-12 pb-6 flex-shrink-0">
                <div className="relative mx-auto">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-3xl blur-xl opacity-50 transition-opacity" />
                  <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-2xl">
                    <User className="w-10 h-10 text-white" />
                  </div>
                </div>
                <div className="text-center space-y-2 px-6">
                  <CardTitle className="text-2xl md:text-3xl font-bold text-white leading-tight">Perfect for Individuals</CardTitle>
                  <CardDescription className="text-slate-400 text-sm md:text-base">
                    AI-powered email drafts for personal use
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pb-8 flex-grow flex flex-col px-6">
                <div className="space-y-3.5 flex-grow">
                  {[
                    { icon: CheckCircle2, text: "Connect your Gmail in seconds" },
                    { icon: Sparkles, text: "AI learns your writing style" },
                    { icon: Zap, text: "Generate personalized drafts" },
                    { icon: Lock, text: "No team setup required" }
                  ].map((feature, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/30 hover:border-blue-500/30 hover:bg-slate-800/80 transition-all group/item"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center flex-shrink-0 border border-blue-500/20 group-hover/item:scale-110 transition-transform mt-0.5">
                        <feature.icon className="w-4 h-4 text-blue-400" />
                      </div>
                      <span className="text-sm text-slate-200 font-medium leading-relaxed">{feature.text}</span>
                    </div>
                  ))}
                </div>

                <div className="pt-4">
                  <div className="pt-4">
                    <Button
                      size="lg"
                      onClick={() => window.location.href = '/auth/landing?view=register-personal'}
                      className="w-full h-14 text-base font-bold bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white shadow-xl shadow-blue-500/25 hover:shadow-2xl hover:shadow-blue-500/40 transition-all duration-300 group/btn border-0"
                    >
                      <span className="relative flex items-center">
                        Create Personal Account
                        <ArrowRight className="w-5 h-5 ml-3 group-hover/btn:translate-x-1 transition-transform" />
                      </span>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Business/Team Card */}
          <div
            className="group relative overflow-hidden rounded-3xl p-0.5"
            onMouseEnter={() => setHoveredCard('business')}
            onMouseLeave={() => setHoveredCard(null)}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary via-purple-500 to-pink-500 rounded-3xl blur opacity-30 group-hover:opacity-50 transition duration-500 animate-pulse" />
            <Card className="relative h-full bg-gradient-to-br from-slate-900 via-slate-900 to-primary/10 border-primary/30 backdrop-blur-xl hover:border-primary/60 transition-all duration-500 overflow-visible flex flex-col">
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

              <div className="absolute top-3 left-6 z-10">
                <div className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-primary via-purple-500 to-pink-500 text-white text-xs font-bold rounded-full shadow-lg shadow-primary/50">
                  <Star className="w-3 h-3 fill-white" />
                  RECOMMENDED
                </div>
              </div>

              <CardHeader className="space-y-6 pt-12 pb-6 flex-shrink-0">
                <div className="relative mx-auto">
                  <div className="absolute inset-0 bg-gradient-to-r from-primary via-purple-500 to-pink-500 rounded-3xl blur-xl opacity-60 group-hover:opacity-90 transition-opacity" />
                  <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-primary via-purple-500 to-pink-500 flex items-center justify-center shadow-2xl transform transition-all duration-500">
                    <Building2 className="w-10 h-10 text-white" />
                  </div>
                </div>
                <div className="text-center space-y-2 px-6">
                  <CardTitle className="text-2xl md:text-3xl font-bold text-white leading-tight">Business & Teams</CardTitle>
                  <CardDescription className="text-slate-400 text-sm md:text-base">
                    Complete solution for teams & customer support
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pb-8 flex-grow flex flex-col px-6">
                <div className="space-y-3.5">
                  {[
                    { icon: Users, text: "Invite team members & assign roles" },
                    { icon: Mail, text: "Connect multiple email accounts" },
                    { icon: Shield, text: "Set approval workflows & guardrails" },
                    { icon: BarChart3, text: "Analytics & team performance" },
                    { icon: Zap, text: "Shared templates & knowledge base" }
                  ].map((feature, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/30 hover:border-primary/30 hover:bg-slate-800/80 transition-all group/item"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center flex-shrink-0 border border-primary/20 group-hover/item:scale-110 transition-transform mt-0.5">
                        <feature.icon className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-sm text-slate-200 font-medium leading-relaxed">{feature.text}</span>
                    </div>
                  ))}
                </div>

                <div className="pt-4 mt-auto">
                  <Button
                    size="lg"
                    onClick={handleBusinessSignup}
                    className="w-full h-14 text-base font-bold bg-gradient-to-r from-primary via-purple-500 to-pink-500 hover:from-primary/90 hover:via-purple-500/90 hover:to-pink-500/90 text-white shadow-2xl shadow-primary/30 hover:shadow-3xl hover:shadow-primary/50 transition-all duration-300 group/btn border-0 relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700" />
                    <span className="relative flex items-center">
                      Create Business Account
                      <ArrowRight className="w-5 h-5 ml-3 group-hover/btn:translate-x-1 transition-transform" />
                    </span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="relative mt-32 max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-white mb-4">What's the Difference?</h2>
            <p className="text-slate-400 text-lg">Choose the plan that fits your needs</p>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-900/50 backdrop-blur-xl shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="text-left py-6 px-6 font-bold text-white text-lg">Feature</th>
                    <th className="text-center py-6 px-6 font-bold text-white text-lg">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                          <User className="w-5 h-5 text-white" />
                        </div>
                        Personal
                      </div>
                    </th>
                    <th className="text-center py-6 px-6 font-bold text-white text-lg">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-white" />
                        </div>
                        Business
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {[
                    { feature: "AI Email Drafts", personal: true, business: true },
                    { feature: "Gmail Integration", personal: true, business: true },
                    { feature: "Writing Style Learning", personal: true, business: true },
                    { feature: "Team Members", personal: false, business: true },
                    { feature: "Role Management (Admin/Manager/Agent)", personal: false, business: true },
                    { feature: "Multiple Email Accounts", personal: false, business: true },
                    { feature: "Approval Workflows & Guardrails", personal: false, business: true },
                    { feature: "Shared Knowledge Base", personal: false, business: true },
                    { feature: "Team Analytics & Reporting", personal: false, business: true },
                    { feature: "Agent Invitations", personal: false, business: true }
                  ].map((row, index) => (
                    <tr key={index} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-4 px-6 text-sm text-slate-300 font-medium">{row.feature}</td>
                      <td className="py-4 px-6 text-center">
                        {row.personal ? (
                          <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20">
                            <CheckCircle2 className="w-5 h-5 text-green-400" />
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xl">—</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {row.business ? (
                          <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20">
                            <CheckCircle2 className="w-5 h-5 text-primary" />
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xl">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Social Proof & Testimonials */}


        {/* CTA Section */}
        <div className="relative mt-24 text-center">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold text-white">
              Ready to Transform Your Email Workflow?
            </h2>
            <p className="text-lg text-slate-300">
              Join teams using AI to write better emails, faster.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

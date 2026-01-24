"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Sparkles, CheckCircle2 } from "lucide-react"

interface PersonalRegistrationFormProps {
    onSuccess: () => void
    onLoginClick: () => void
}

export default function PersonalRegistrationForm({ onSuccess, onLoginClick }: PersonalRegistrationFormProps) {
    const [loading, setLoading] = useState(false)

    return (
        <div className="w-full min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 items-center">
                {/* Left side - Marketing content */}
                <div className="hidden lg:flex flex-col justify-center space-y-8 px-8">
                    <div className="space-y-4">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm font-semibold">
                            <Sparkles className="w-4 h-4" />
                            Personal Account
                        </div>
                        <h1 className="text-5xl font-bold leading-tight">
                            AI Email Assistant
                            <br />
                            <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                                For Everyone
                            </span>
                        </h1>
                        <p className="text-xl text-muted-foreground leading-relaxed">
                            Experience the power of AI-drafted emails and smart organization, completely free for personal use.
                        </p>
                    </div>

                    <div className="space-y-4">
                        {[
                            { icon: CheckCircle2, text: "Works with any email provider" },
                            { icon: CheckCircle2, text: "Smart drafts & replies" },
                            { icon: CheckCircle2, text: "Priority inbox sorting" },
                            { icon: CheckCircle2, text: "Always free for personal use" },
                        ].map((feature, index) => (
                            <div key={index} className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                                    <feature.icon className="w-4 h-4 text-purple-400" />
                                </div>
                                <span className="text-base text-foreground/80">{feature.text}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right side - Registration form */}
                <Card className="w-full shadow-2xl border-border/60 backdrop-blur-sm">
                    <CardHeader className="space-y-2 pb-6">
                        <CardTitle className="text-3xl font-bold text-center">Create Personal Account</CardTitle>
                        <CardDescription className="text-center text-base">
                            Get started with your free personal account.
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-6">
                        <div className="space-y-4">
                            <Button
                                type="button"
                                onClick={async () => {
                                    try {
                                        setLoading(true)
                                        const response = await fetch('/api/auth/gmail')
                                        if (response.ok) {
                                            const { authUrl } = await response.json()
                                            window.location.href = authUrl
                                        } else {
                                            console.error('Failed to get auth URL')
                                            setLoading(false)
                                        }
                                    } catch (error) {
                                        console.error('Error connecting Gmail:', error)
                                        setLoading(false)
                                    }
                                }}
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
                                        Sign up with Google
                                    </>
                                )}
                            </Button>

                            {/* Divider */}
                            <div className="relative py-2">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-border"></div>
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-card px-2 text-muted-foreground">Already have an account?</span>
                                </div>
                            </div>

                            {/* Login Link */}
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onLoginClick}
                                className="w-full h-11 font-medium"
                                disabled={loading}
                            >
                                Sign In
                            </Button>
                        </div>

                        {/* Terms */}
                        <p className="text-xs text-center text-muted-foreground">
                            By creating an account, you agree to our{" "}
                            <a href="#" className="underline hover:text-foreground">Terms of Service</a>
                            {" "}and{" "}
                            <a href="#" className="underline hover:text-foreground">Privacy Policy</a>
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

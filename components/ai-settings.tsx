"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import KnowledgeBaseManager from "@/components/knowledge-base"
import GuardrailsManager from "@/components/guardrails-manager"
import { BookOpen, Shield, Sparkles, Zap, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export default function AISettings() {
  const [activeTab, setActiveTab] = useState("overview")
  const [regenerating, setRegenerating] = useState(false)
  const { toast } = useToast()

  const handleRegenerateEmbeddings = async () => {
    if (!confirm('This will regenerate embeddings for all your past emails with the new intent-based system. This may take a few minutes. Continue?')) {
      return
    }

    setRegenerating(true)
    try {
      const response = await fetch('/api/emails/regenerate-embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auto: true,
          force: true, // Force regeneration of all emails to include intent
          limit: 1000,
        }),
      })

      const result = await response.json()

      if (response.ok) {
        toast({
          title: "✅ Embeddings Regenerated",
          description: `Processed ${result.processed} emails. ${result.errors > 0 ? `${result.errors} errors occurred.` : ''}`,
        })
      } else {
        toast({
          title: "❌ Error",
          description: result.error || 'Failed to regenerate embeddings',
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "❌ Error",
        description: error instanceof Error ? error.message : 'Failed to regenerate embeddings',
        variant: "destructive",
      })
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div className="bg-background h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 lg:p-10">
        {/* Header Section */}
        <div className="mb-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-foreground tracking-tight">AI Customization</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Train your AI assistant to match your brand voice and business rules
              </p>
            </div>
          </div>
        </div>

        {/* Tabs Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-3 h-auto p-1 bg-muted/50 rounded-xl">
            <TabsTrigger 
              value="overview" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md py-3 font-medium transition-all data-[state=inactive]:text-muted-foreground"
            >
              <Zap className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger 
              value="guardrails" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md py-3 font-medium transition-all data-[state=inactive]:text-muted-foreground"
            >
              <Shield className="w-4 h-4 mr-2" />
              Guardrails
            </TabsTrigger>
            <TabsTrigger 
              value="knowledge" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md py-3 font-medium transition-all data-[state=inactive]:text-muted-foreground"
            >
              <BookOpen className="w-4 h-4 mr-2" />
              Knowledge Base
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            <Card className="border-2 shadow-xl">
              <CardHeader className="pb-6">
                <CardTitle className="text-2xl">How AI Customization Works</CardTitle>
                <CardDescription className="text-base">
                  Control every aspect of how your AI assistant communicates with customers
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Feature Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Guardrails Feature */}
                  <div className="group p-6 rounded-xl border-2 border-border hover:border-amber-500/50 transition-all duration-300 hover:shadow-lg bg-gradient-to-br from-amber-500/5 to-transparent">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/30 to-amber-500/10 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                        <Shield className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="space-y-2 flex-1">
                        <h3 className="font-semibold text-lg">AI Guardrails</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Set tone, style, and safety rules. Define what your AI can and can't say to maintain brand consistency and compliance.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-2">
                          <Badge variant="secondary" className="text-xs">Tone Control</Badge>
                          <Badge variant="secondary" className="text-xs">Safety Rules</Badge>
                          <Badge variant="secondary" className="text-xs">Word Filters</Badge>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Knowledge Base Feature */}
                  <div className="group p-6 rounded-xl border-2 border-border hover:border-primary/50 transition-all duration-300 hover:shadow-lg bg-gradient-to-br from-primary/5 to-transparent">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                        <BookOpen className="w-6 h-6 text-primary" />
                      </div>
                      <div className="space-y-2 flex-1">
                        <h3 className="font-semibold text-lg">Knowledge Base</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Create reusable content snippets that AI can reference. Build a library of policies, FAQs, and standard responses.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-2">
                          <Badge variant="secondary" className="text-xs">Snippets</Badge>
                          <Badge variant="secondary" className="text-xs">Tags</Badge>
                          <Badge variant="secondary" className="text-xs">Search</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Start Guide */}
                <div className="rounded-xl bg-muted/50 p-6 space-y-4">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    Quick Start Guide
                  </h3>
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-primary">1</div>
                      <div>
                        <p className="text-sm font-medium">Set up Guardrails first</p>
                        <p className="text-sm text-muted-foreground">Define your brand tone, writing style, and safety rules</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-primary">2</div>
                      <div>
                        <p className="text-sm font-medium">Build your Knowledge Base</p>
                        <p className="text-sm text-muted-foreground">Add common responses, policies, and helpful information</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-primary">3</div>
                      <div>
                        <p className="text-sm font-medium">Test your AI responses</p>
                        <p className="text-sm text-muted-foreground">Generate drafts and refine your settings based on results</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Regenerate Embeddings Section */}
                <Card className="border-2 border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <RefreshCw className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                      Regenerate Email Embeddings
                    </CardTitle>
                    <CardDescription>
                      Update all past email embeddings with the new intent-based system for better AI matching accuracy
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      After updating the AI system, regenerate embeddings to ensure your past emails use the new intent-based matching. 
                      This improves how the AI learns from your email history.
                    </p>
                    <Button
                      onClick={handleRegenerateEmbeddings}
                      disabled={regenerating}
                      className="w-full sm:w-auto"
                      variant="outline"
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${regenerating ? 'animate-spin' : ''}`} />
                      {regenerating ? 'Regenerating...' : 'Regenerate Embeddings'}
                    </Button>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Guardrails Tab */}
          <TabsContent value="guardrails" className="space-y-6 mt-6">
            <GuardrailsManager />
          </TabsContent>

          {/* Knowledge Base Tab */}
          <TabsContent value="knowledge" className="space-y-6 mt-6">
            <KnowledgeBaseManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}


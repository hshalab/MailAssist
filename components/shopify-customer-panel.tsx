"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Skeleton } from "./ui/skeleton"
import {
  ShoppingBag, Package, DollarSign, Calendar, MapPin,
  CheckCircle2, XCircle, AlertCircle, Loader2, ExternalLink
} from "lucide-react"
import { Button } from "./ui/button"

interface ShopifyCustomer {
  id: number
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  totalSpent: number
  ordersCount: number
  orders_count?: number // potential snake_case from API
  tags: string[]
  createdAt: string
  verifiedEmail: boolean
  addresses?: Array<{
    id: number
    address1: string
    city: string
    province?: string
    country: string
    zip?: string
    isDefault: boolean
  }>
  total_spent?: string // potential snake_case from API
}

interface ShopifyOrder {
  id: number
  name: string
  createdAt: string
  financialStatus: string
  fulfillmentStatus?: string
  totalPrice: string
  totalPriceSet: {
    shopMoney: {
      amount: string
      currencyCode: string
    }
  }
  cancelled: boolean
  lineItems: Array<{
    title: string
    quantity: number
    price: string
  }>
}

interface ShopifyCustomerPanelProps {
  customerEmail: string
  shopDomain?: string
}

export default function ShopifyCustomerPanel({ customerEmail, shopDomain }: ShopifyCustomerPanelProps) {
  const [loading, setLoading] = useState(true)
  const [customer, setCustomer] = useState<ShopifyCustomer | null>(null)
  const [orders, setOrders] = useState<ShopifyOrder[]>([])
  const [totalSpent, setTotalSpent] = useState(0)
  const [currency, setCurrency] = useState('USD')
  const [error, setError] = useState<string | null>(null)
  const [isConfigured, setIsConfigured] = useState(false)

  // State to store shopDomain if not passed as prop
  const [internalShopDomain, setInternalShopDomain] = useState<string | undefined>(shopDomain)

  // Update internal state if prop changes
  useEffect(() => {
    if (shopDomain) setInternalShopDomain(shopDomain)
  }, [shopDomain])

  // Extract email from "Name <email@example.com>" format
  const extractedEmail = (() => {
    if (!customerEmail) return ''
    const match = customerEmail.match(/<(.+?)>/)
    return match ? match[1] : customerEmail
  })()

  useEffect(() => {
    if (!extractedEmail) return

    setLoading(true)
    setError(null)

    // Check if Shopify is configured
    fetch('/api/shopify/config')
      .then(res => res.json())
      .then(data => {
        if (data.config && data.config.isConfigured) {
          setIsConfigured(true)
          // If shopDomain prop was missing, try to get it from config
          if (!shopDomain && data.config.shopDomain) {
            // shopUrl might be "https://domain.myshopify.com" or just details
            // Let's assume the API returns the domain or we can parse it
            // API usually returns { config: { shopUrl: '...', ... } }
            let domain = data.config.shopDomain.replace(/^https?:\/\//, '')
            if (domain.endsWith('/')) domain = domain.slice(0, -1)
            setInternalShopDomain(domain)
          }
          fetchCustomerData()
        } else {
          setLoading(false)
          setIsConfigured(false)
        }
      })
      .catch(err => {
        console.error('Error checking Shopify config:', err)
        setLoading(false)
        setIsConfigured(false)
      })
  }, [extractedEmail, shopDomain])

  const fetchCustomerData = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`/api/shopify/customer?email=${encodeURIComponent(extractedEmail)}`)

      if (!response.ok) {
        if (response.status === 404) {
          // Check if it's a config error or customer not found
          const errorData = await response.json()
          if (errorData.error && errorData.error.includes('not configured')) {
            setError('Shopify integration not configured')
            setIsConfigured(false)
          } else {
            // Customer exists but not found in Shopify
            setError('No customer found in Shopify')
          }
          return
        }
        throw new Error('Failed to fetch customer data')
      }

      const data = await response.json()
      console.log('[ShopifyPanel] Data received:', {
        customer: data.customer,
        recentOrdersLength: data.recentOrders?.length,
        recentOrdersSnake: data.recent_orders?.length,
        ordersLength: data.orders?.length
      })
      setCustomer(data.customer)
      // Fallback to recent_orders (snake_case) or orders if recentOrders is missing
      const processedOrders = data.recentOrders || data.recent_orders || data.orders || []
      setOrders(processedOrders)
      setTotalSpent(data.totalSpent || 0)

      // Use currency from API response
      if (data.currency) {
        console.log('[Shopify] Detected currency:', data.currency)
        setCurrency(data.currency)
      } else {
        console.log('[Shopify] No currency in response, using default USD')
      }
    } catch (err) {
      console.error('Error fetching Shopify customer data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load customer data')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: string | number, currency: string = 'USD') => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    const currencySymbols: { [key: string]: string } = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      JPY: '¥',
      CAD: '$',
      AUD: '$',
      PKR: 'Rs',
      INR: '₹',
      CNY: '¥',
    }
    const symbol = currencySymbols[currency] || currency
    return `${symbol}${numAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateString
    }
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'paid':
      case 'fulfilled':
        return 'text-green-600 dark:text-green-400'
      case 'pending':
      case 'unfulfilled':
        return 'text-yellow-600 dark:text-yellow-400'
      case 'refunded':
      case 'cancelled':
        return 'text-red-600 dark:text-red-400'
      default:
        return 'text-muted-foreground'
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" />
            Shopify Customer Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-12" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" />
            Shopify Customer Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-4">
            {error}
            <br />
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCustomerData}
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!isConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" />
            Shopify Customer Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-4">
            Shopify integration not configured
            <br />
            <span className="text-xs">Configure in Settings to view customer data</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if ((!loading && isConfigured) && !customer && orders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" />
            Shopify Customer Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-4">
            No customer found in Shopify
            <br />
            <span className="text-xs">This email may not be associated with any orders</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <ShoppingBag className="h-4 w-4" />
          Shopify Customer Info
        </CardTitle>
        {shopDomain && (
          <CardDescription className="text-xs">
            {shopDomain}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Customer Summary */}
        {customer && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Total Spent</div>
                <div className="text-lg font-semibold">
                  {formatCurrency(customer.totalSpent.toString(), currency)}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Orders</div>
                <div className="text-lg font-semibold flex items-center gap-1">
                  <Package className="h-4 w-4" />
                  {customer.ordersCount}
                </div>
              </div>
            </div>

            {customer.firstName || customer.lastName ? (
              <div className="text-sm">
                <span className="font-medium">
                  {customer.firstName} {customer.lastName}
                </span>
              </div>
            ) : null}

            {customer.phone && (
              <div className="text-sm text-muted-foreground">
                📞 {customer.phone}
              </div>
            )}

            {customer.verifiedEmail ? (
              <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3" />
                Verified email
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <AlertCircle className="h-3 w-3" />
                Unverified email
              </div>
            )}

            {customer.addresses && customer.addresses.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  Address
                </div>
                {customer.addresses
                  .filter(addr => addr.isDefault)
                  .map(addr => (
                    <div key={addr.id} className="text-sm">
                      {addr.address1}
                      <br />
                      {addr.city}, {addr.province && `${addr.province}, `}{addr.country} {addr.zip}
                    </div>
                  ))}
              </div>
            )}

            {customer.tags && customer.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {customer.tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-0.5 bg-muted rounded-md"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recent Orders */}
        {orders.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <div className="text-sm font-semibold text-foreground">
              Recent Orders ({orders.length})
            </div>
            <div className="space-y-2">
              {orders.slice(0, 5).map((order) => (
                <div
                  key={order.id}
                  className={`p-3 bg-muted/50 rounded-md text-xs space-y-2 border border-border/50 hover:border-border transition-colors ${shopDomain ? 'cursor-pointer hover:bg-muted' : ''}`}
                  onClick={() => {
                    if (shopDomain) {
                      window.open(`https://${shopDomain}/admin/orders/${order.id}`, '_blank')
                    }
                  }}
                >
                  {/* Order header */}
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{order.name}</span>
                    <span className="font-bold text-base">
                      {formatCurrency(
                        order.totalPriceSet?.shopMoney?.amount || order.totalPrice || '0',
                        currency
                      )}
                    </span>
                  </div>

                  {/* Order metadata */}
                  <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(order.createdAt)}
                    </span>
                    {order.financialStatus && (
                      <>
                        <span>•</span>
                        <span className={`capitalize font-medium ${getStatusColor(order.financialStatus)}`}>
                          {order.financialStatus}
                        </span>
                      </>
                    )}
                    {order.fulfillmentStatus && (
                      <>
                        <span>•</span>
                        <span className={`capitalize font-medium ${getStatusColor(order.fulfillmentStatus)}`}>
                          {order.fulfillmentStatus}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Line items */}
                  {order.lineItems && order.lineItems.length > 0 && (
                    <div className="bg-muted/50 rounded p-2 space-y-1 border-l-2 border-primary/30">
                      {order.lineItems.slice(0, 3).map((item: any, idx: number) => (
                        <div key={idx} className="text-muted-foreground text-xs">
                          <span className="font-medium">{item.quantity}x</span> {item.title}
                          {item.sku && <span className="text-muted-foreground/70"> (SKU: {item.sku})</span>}
                        </div>
                      ))}
                      {order.lineItems.length > 3 && (
                        <div className="text-muted-foreground/70 italic">
                          +{order.lineItems.length - 3} more items
                        </div>
                      )}
                    </div>
                  )}

                  {/* Order note if present */}
                  <div className="mt-2 text-xs text-muted-foreground/80 bg-muted/30 p-2 rounded">
                    Note: Order details available in Shopify Admin
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* View in Shopify Link */}
        {
          customer && shopDomain && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                window.open(
                  `https://${shopDomain}/admin/customers/${customer.id}`,
                  '_blank'
                )
              }}
            >
              <ExternalLink className="h-3 w-3 mr-2" />
              View in Shopify
            </Button>
          )
        }
      </CardContent >
    </Card >
  )
}






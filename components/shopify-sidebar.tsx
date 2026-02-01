"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Skeleton } from "./ui/skeleton"
import { Button } from "./ui/button"
import {
  ShoppingBag, Package, DollarSign, Calendar, MapPin,
  CheckCircle2, XCircle, AlertCircle, Loader2, ExternalLink, X
} from "lucide-react"
import { Alert, AlertDescription } from "./ui/alert"

interface ShopifySidebarProps {
  customerEmail: string
  shopDomain?: string
  onClose?: () => void
}

export default function ShopifySidebar({ customerEmail, shopDomain, onClose }: ShopifySidebarProps) {
  const [loading, setLoading] = useState(true)
  const [customer, setCustomer] = useState<any>(null)
  const [orders, setOrders] = useState<any[]>([])
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

  // Optimize: Check config and fetch data in a more streamlined way
  useEffect(() => {
    if (!extractedEmail) return

    let isMounted = true;
    setLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        // Parallelize: 
        // 1. Check/Get config (if we don't know if it's configured)
        // 2. Fetch customer data (optimistically, assuming configured if we have a shop domain)

        // If we already have shopDomain prop, we can assume it's likely configured or at least try fetching
        // But we still need to check valid tokens on backend. 
        // Actually, the /api/shopify/customer endpoint checks config internally too.
        // So we can arguably just call that directly, and if it returns "not configured", then we update state.

        // However, the existing logic checks /api/shopify/config first to get the domain if missing.

        let currentShopDomain = internalShopDomain;
        let configValid = isConfigured;

        // Step 1: Ensure we have config/domain
        if (!currentShopDomain || !configValid) {
          const configRes = await fetch('/api/shopify/config');
          const configData = await configRes.json();

          if (configData.config && configData.config.isConfigured) {
            setIsConfigured(true);
            configValid = true;

            if (!currentShopDomain) {
              let domain = configData.config.shopDomain || configData.config.shopUrl || '';
              domain = domain.replace(/^https?:\/\//, '');
              if (domain.endsWith('/')) domain = domain.slice(0, -1);
              setInternalShopDomain(domain);
              currentShopDomain = domain;
            }
          } else {
            if (isMounted) {
              setIsConfigured(false);
              setLoading(false);
            }
            return; // Stop if not configured
          }
        }

        // Step 2: Fetch customer data
        if (configValid) {
          const customerRes = await fetch(`/api/shopify/customer?email=${encodeURIComponent(extractedEmail)}`);

          if (!customerRes.ok) {
            if (customerRes.status === 404) {
              const errorData = await customerRes.json();
              if (errorData.error && errorData.error.includes('not configured')) {
                throw new Error('Shopify integration not configured');
              } else {
                throw new Error('No customer found in Shopify');
              }
            }
            throw new Error('Failed to fetch customer data');
          }

          const data = await customerRes.json();

          if (isMounted) {
            console.log('[ShopifySidebar] Data received:', {
              customer: data.customer,
              recentOrdersLength: data.recentOrders?.length
            });
            setCustomer(data.customer);
            const processedOrders = data.recentOrders || data.recent_orders || data.orders || [];
            setOrders(processedOrders);
            setTotalSpent(data.totalSpent || 0);
            if (data.currency) setCurrency(data.currency);
          }
        }

      } catch (err) {
        if (isMounted) {
          console.error('Error loading Shopify data:', err);
          // If specific error message from our API, use it
          const msg = err instanceof Error ? err.message : 'Failed to load data';
          if (msg === 'Shopify integration not configured') {
            setIsConfigured(false);
            setError('Shopify integration not configured');
          } else if (msg === 'No customer found in Shopify') {
            setError('No customer found in Shopify');
          } else {
            setError(msg);
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();

    return () => { isMounted = false; };
  }, [extractedEmail, shopDomain]); // Removed internalShopDomain dependency to avoid loop, dependent only on prop and email

  // Removed separate fetchCustomerData function as it's merged into the effect for better control
  const fetchCustomerData = () => {
    // Re-trigger by clearing error and ensuring loading state, logic inside effect handles rest or we can extract logic
    // For retry button, we can just trigger a re-run or copy the logic.
    // Easiest is to force a re-run or just extract the async function.
    // For now, let's keep it simple and just allow the Retry button to work by defining this:
    setLoading(true);
    setError(null);
    // Re-run the effect logic conceptually
    // We can achieve this by dirty-toggling a refresh key if needed, or just copying the fetch logic.
    // Let's just copy the fetch logic for the retry button specifically to be safe.

    // ... actually, extracting the inner function is cleaner.
    // Let's rely on the effect for first load, and this for retries.

    const retryLoad = async () => {
      try {
        // (Same logic as above, simplified for retry which assumes we want to try fetching)
        const customerRes = await fetch(`/api/shopify/customer?email=${encodeURIComponent(extractedEmail)}`);
        if (!customerRes.ok) throw new Error('Failed to fetch customer data');
        const data = await customerRes.json();
        setCustomer(data.customer);
        const processedOrders = data.recentOrders || data.recent_orders || data.orders || [];
        setOrders(processedOrders);
        setTotalSpent(data.totalSpent || 0);
        if (data.currency) setCurrency(data.currency);
      } catch (e) {
        setError('Failed to list customer data');
      } finally {
        setLoading(false);
      }
    };
    retryLoad();
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

  return (
    <div className="flex flex-col h-full w-full bg-card border-l border-border/50 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border/50 bg-card/50 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Shopify Customer</h2>
          </div>
          {onClose && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="h-8 w-8 p-0 transition-all duration-300 ease-out hover:scale-110 hover:bg-muted hover:shadow-sm"
              title="Close Shopify Info"
            >
              <X className="w-4 h-4 transition-transform duration-300 hover:rotate-90" />
            </Button>
          )}
        </div>
        {internalShopDomain && (
          <p className="text-xs text-muted-foreground">{internalShopDomain}</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ... (error/loading/empty states remain same) ... */}
        {error ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive/50" />
            <p className="text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCustomerData}
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        ) : loading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !isConfigured ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            <ShoppingBag className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <p>Shopify integration not configured</p>
            <p className="text-xs mt-2">Configure in Settings to view customer data</p>
          </div>
        ) : (!customer) ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            <ShoppingBag className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <p>No customer found in Shopify</p>
            <p className="text-xs mt-2">This email may not be associated with any orders</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Customer Summary */}
            {customer && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  {/* ... (customer details remain same) ... */}
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
                        .filter((addr: any) => addr.isDefault)
                        .map((addr: any) => (
                          <div key={addr.id} className="text-xs">
                            {addr.address1}
                            {addr.address2 && `, ${addr.address2}`}
                            <br />
                            {addr.city}, {addr.province} {addr.zip}
                            <br />
                            {addr.country}
                          </div>
                        ))}
                    </div>
                  )}

                  {customer.tags && customer.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {customer.tags.map((tag: string, idx: number) => (
                        <span
                          key={idx}
                          className="text-xs px-2 py-0.5 bg-muted rounded-md"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Recent Orders */}
            {orders.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Recent Orders ({orders.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {orders.slice(0, 5).map((order) => (
                    <div
                      key={order.id}
                      className={`p-3 bg-muted/50 rounded-md text-xs space-y-2 border border-border/50 hover:border-border transition-colors ${internalShopDomain ? 'cursor-pointer hover:bg-muted' : ''}`}
                      onClick={() => {
                        if (internalShopDomain) {
                          window.open(`https://${internalShopDomain}/admin/orders/${order.id}`, '_blank')
                        }
                      }}
                    >
                      {/* Order header with number and total */}
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
                </CardContent>
              </Card>
            )}

            {/* View in Shopify Link */}
            {customer && internalShopDomain && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  window.open(
                    `https://${internalShopDomain}/admin/customers/${customer.id}`,
                    '_blank'
                  )
                }}
              >
                <ExternalLink className="h-3 w-3 mr-2" />
                View in Shopify
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}






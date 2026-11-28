import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Bike,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  LocateFixed,
  MapPin,
  Menu,
  MessageCircle,
  Moon,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import {
  apiRequest,
  newIdempotencyKey,
  restoreSession,
  signIn,
  signOut,
  signUp,
  type AccountRole,
  type AppConfig,
  type DriverStatus,
  type RideKind,
  type RideQuote,
  type Trip,
  type User,
  type WalletState,
} from "./api";

type View = "ride" | "activity" | "wallet" | "drive";
type Booking = {
  id: string;
  destination: string;
  pickup: string;
  kind: RideKind;
  price: number;
  acceptedAt: string;
  driverPayoutCents: number;
  unionShareCents: number;
  eta: number;
  createdAt: string;
  status: Trip["status"];
  paymentStatus: Trip["paymentStatus"];
  driverId: string | null;
};
const THEME_STORAGE_KEY = "uniondrive16.theme";

const options: Array<{
  kind: RideKind;
  description: string;
  icon: typeof CarFront;
  basePrice: number;
  eta: number;
}> = [
  { kind: "Everyday", description: "Affordable, everyday rides", icon: CarFront, basePrice: 14.5, eta: 4 },
  { kind: "Comfort", description: "Newer cars, extra legroom", icon: Sparkles, basePrice: 21.75, eta: 6 },
  { kind: "XL", description: "Room for up to 6", icon: UsersRound, basePrice: 29.25, eta: 8 },
];

const suggestions = [
  { name: "Union Square", address: "Union Square, San Francisco", icon: MapPin },
  { name: "Ferry Building", address: "1 Ferry Building, San Francisco", icon: MapPin },
  { name: "Golden Gate Park", address: "Golden Gate Park, San Francisco", icon: MapPin },
  { name: "San Francisco International Airport", address: "SFO International Terminal", icon: MapPin },
];

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function presentBooking(trip: Trip): Booking {
  return {
    id: trip.id,
    destination: trip.destination,
    pickup: trip.pickup,
    kind: trip.kind,
    price: trip.fareCents / 100,
    acceptedAt: trip.acceptedAt ?? trip.createdAt,
    driverPayoutCents: trip.driverPayoutCents,
    unionShareCents: trip.unionShareCents,
    eta: Math.max(1, Math.ceil(trip.durationSeconds / 60)),
    createdAt: trip.createdAt,
    status: trip.status,
    paymentStatus: trip.paymentStatus,
    driverId: trip.driverId,
  };
}

function App() {
  const [view, setView] = useState<View>("ride");
  const [destination, setDestination] = useState("");
  const [pickup, setPickup] = useState("Current location");
  const [selectedKind, setSelectedKind] = useState<RideKind>("Everyday");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [serviceError, setServiceError] = useState("");
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [quote, setQuote] = useState<RideQuote | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [history, setHistory] = useState<Booking[]>([]);
  const [walletState, setWalletState] = useState<WalletState | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [driverOnline, setDriverOnline] = useState(false);
  const [availableTrips, setAvailableTrips] = useState<Booking[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [destinationFocused, setDestinationFocused] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    void Promise.all([restoreSession(), apiRequest<AppConfig>("/api/config")])
      .then(async ([sessionUser, config]) => {
        setUser(sessionUser);
        setAppConfig(config);
        if (sessionUser) setView(sessionUser.role === "driver" ? "drive" : "ride");
        if (sessionUser) {
          const [tripResult, wallet] = await Promise.all([
            apiRequest<{ trips: Trip[] }>("/api/trips"),
            apiRequest<WalletState>("/api/wallet"),
          ]);
          const trips = tripResult.trips.map(presentBooking);
          setHistory(trips);
          setBooking(trips.find((trip) => trip.status === "requested" || trip.status === "accepted") ?? null);
          setWalletState(wallet);
          setDriverOnline(sessionUser.isOnline);
        }
      })
      .catch((error: unknown) => setServiceError(error instanceof Error ? error.message : "The UnionDrive service could not be reached."))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    try {
      setDarkMode(window.localStorage.getItem(THEME_STORAGE_KEY) === "dark");
    } catch {
      setServiceError("Your appearance preference could not be loaded.");
    } finally {
      setThemeLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!themeLoaded) return;
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", darkMode ? "#141a16" : "#f4f7fb");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
    } catch {
      setServiceError("Your appearance preference could not be saved on this device.");
    }
  }, [darkMode, themeLoaded]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const chooseView = (nextView: View) => {
    setView(nextView);
    setMenuOpen(false);
  };

  const refreshAccount = async (account = user) => {
    if (!account) return;
    const [tripResult, wallet] = await Promise.all([
      apiRequest<{ trips: Trip[] }>("/api/trips"),
      apiRequest<WalletState>("/api/wallet"),
    ]);
    const trips = tripResult.trips.map(presentBooking);
    setHistory(trips);
    setBooking(trips.find((trip) => trip.status === "requested" || trip.status === "accepted") ?? null);
    setWalletState(wallet);
  };

  const handleAuthentication = async (
    mode: "signin" | "signup",
    input: { name: string; email: string; password: string; role: AccountRole },
  ) => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const nextUser = mode === "signin"
        ? await signIn({ email: input.email, password: input.password })
        : await signUp(input);
      setUser(nextUser);
      setView(nextUser.role === "driver" ? "drive" : "ride");
      setDriverOnline(nextUser.isOnline);
      setServiceError("");
      try {
        await refreshAccount(nextUser);
      } catch (error) {
        setServiceError(error instanceof Error ? `Signed in, but account data could not be loaded: ${error.message}` : "Signed in, but account data could not be loaded.");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not authenticate this account.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setUser(null);
      setHistory([]);
      setBooking(null);
      setWalletState(null);
      setQuote(null);
      setAvailableTrips([]);
      setView("ride");
      setToast("You have signed out.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not sign out.");
    }
  };

  const requestRide = async () => {
    const cleanDestination = destination.trim();
    if (!cleanDestination) {
      setToast("Add a destination to see your ride options.");
      return;
    }
    if (!user || user.role !== "rider") {
      setToast("Sign in with a rider account to request a trip.");
      return;
    }
    if (booking) {
      setToast("You already have an active trip request.");
      return;
    }
    const currentQuote = quote &&
      quote.pickup === pickup.trim() &&
      quote.destination === cleanDestination &&
      quote.kind === selectedKind &&
      Date.parse(quote.expiresAt) > Date.now()
        ? quote
        : null;
    setActionBusy(true);
    try {
      if (!currentQuote) {
        const freshQuote = await apiRequest<RideQuote>("/api/quotes", {
          method: "POST",
          body: { pickup: pickup.trim(), destination: cleanDestination, kind: selectedKind },
        });
        setQuote(freshQuote);
        setToast(`Fare quote: ${formatMoney(freshQuote.fareCents)}. Review it, then request your ride.`);
        return;
      }
      await apiRequest<Trip>("/api/trips", {
        method: "POST",
        body: { quoteId: currentQuote.id },
        idempotencyKey: newIdempotencyKey(),
      });
      setQuote(null);
      setDestinationFocused(false);
      await refreshAccount(user);
      setToast("Ride request sent. Your wallet is charged only if a driver accepts.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not request a ride.");
    } finally {
      setActionBusy(false);
    }
  };

  const addDemoFunds = async (amountCents: number) => {
    try {
      await apiRequest<WalletState>("/api/wallet/demo-topups", {
        method: "POST",
        body: { amountCents },
        idempotencyKey: newIdempotencyKey(),
      });
      await refreshAccount();
      setToast(`${formatMoney(amountCents)} demo credits added by the server.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not add demo credits.");
    }
  };

  const cancelBooking = async () => {
    if (!booking) return;
    try {
      await apiRequest<Trip>(`/api/trips/${booking.id}/cancel`, {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
      });
      await refreshAccount();
      setToast("Trip cancelled. Demo refunds are recorded on the server.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not cancel this trip.");
    }
  };

  const completeBooking = async () => {
    if (!booking || user?.role !== "driver") return;
    try {
      await apiRequest<Trip>(`/api/trips/${booking.id}/complete`, {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
      });
      await refreshAccount();
      setToast("Trip marked complete.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not complete this trip.");
    }
  };

  const toggleDriverOnline = async () => {
    if (!user || user.role !== "driver") return;
    try {
      const result = await apiRequest<{ online: boolean; driverStatus: DriverStatus }>("/api/driver/availability", {
        method: "PATCH",
        body: { online: !driverOnline },
      });
      setDriverOnline(result.online);
      setUser({ ...user, isOnline: result.online, driverStatus: result.driverStatus });
      setAvailableTrips([]);
      setToast(result.online ? "You are online." : "You are offline.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not update driver status.");
    }
  };

  const refreshDriverRequests = async () => {
    try {
      const result = await apiRequest<{ trips: Trip[] }>("/api/trips/requests");
      setAvailableTrips(result.trips.map(presentBooking));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not load ride requests.");
    }
  };

  const acceptDriverTrip = async (trip: Booking) => {
    try {
      await apiRequest<Trip>(`/api/trips/${trip.id}/accept`, {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
      });
      setAvailableTrips((previous) => previous.filter((item) => item.id !== trip.id));
      await refreshAccount();
      setToast("Trip accepted. The demo fare was charged and split on the server.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not accept this trip.");
      void refreshDriverRequests();
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setToast("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setPickup(`${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`),
      () => setToast("We couldn't access your location. Check your browser permissions."),
      { enableHighAccuracy: false, timeout: 8000 },
    );
    setQuote(null);
  };

  if (authLoading) return <LoadingScreen darkMode={darkMode} />;
  if (!user) {
    return (
      <AuthScreen
        darkMode={darkMode}
        error={authError || serviceError}
        loading={authBusy}
        onSubmit={handleAuthentication}
        onToggleTheme={() => setDarkMode((enabled) => !enabled)}
      />
    );
  }

  const navItems: Array<{ id: View; label: string; icon: typeof CarFront }> = [
    ...(user.role === "rider" ? [{ id: "ride" as const, label: "Book a ride", icon: CarFront }] : []),
    { id: "activity", label: "Your rides", icon: Clock3 },
    { id: "wallet", label: "Wallet", icon: WalletCards },
    ...(user.role === "driver" ? [{ id: "drive" as const, label: "Drive with us", icon: Bike }] : []),
  ];
  const activeQuote =
    quote &&
    quote.pickup === pickup.trim() &&
    quote.destination === destination.trim() &&
    quote.kind === selectedKind &&
    Date.parse(quote.expiresAt) > Date.now()
      ? quote
      : null;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); chooseView(user.role === "driver" ? "drive" : "ride"); }}>
          <span className="brand-mark">U<span>.</span></span>
          <span className="brand-name">UnionDrive<span className="brand-number">#16</span></span>
        </a>
        <div className="sidebar-label">YOUR SPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${view === id ? "nav-item-active" : ""}`}
              key={id}
              onClick={() => chooseView(id)}
              type="button"
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "activity" && history.length > 0 && <span className="nav-count">{history.length}</span>}
            </button>
          ))}
        </nav>
        <button
          className="nav-item theme-toggle"
          type="button"
          role="switch"
          aria-checked={darkMode}
          aria-label={darkMode ? "Turn off dark mode" : "Turn on dark mode"}
          onClick={() => setDarkMode((enabled) => !enabled)}
        >
          {darkMode ? <Sun size={19} strokeWidth={1.8} /> : <Moon size={19} strokeWidth={1.8} />}
          <span>Dark mode</span>
          <span className={`theme-switch ${darkMode ? "theme-switch-on" : ""}`} aria-hidden="true"><span /></span>
        </button>
        <div className="sidebar-spacer" />
        <div className="sidebar-promo">
          <div className="promo-icon"><Sparkles size={17} /></div>
          <strong>Good trips start here.</strong>
          <p>Everyday rides, with a little more care.</p>
        </div>
        <button className="nav-item help-link" type="button" onClick={() => setToast("Help center coming soon.")}>
          <CircleHelp size={19} strokeWidth={1.8} /><span>Help center</span>
        </button>
        <div className="profile-card">
          <div className="avatar">{user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
          <div className="profile-copy"><strong>{user.name}</strong><span>{user.role === "driver" ? "Driver account" : "Rider account"}</span></div>
          <button className="icon-button profile-menu" aria-label="Sign out" type="button" onClick={() => void handleSignOut()}><ChevronDown size={16} /></button>
        </div>
      </aside>

      {menuOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} type="button" />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)} type="button"><Menu size={21} /></button>
          <div className="topbar-location"><span className="location-dot" /> San Francisco, CA <ChevronDown size={14} /></div>
          <div className="topbar-actions">
            <span className="service-status"><span className="status-dot" /> Demo environment</span>
            <button className="topbar-help" type="button" onClick={() => setToast("Help center coming soon.")}><CircleHelp size={17} /> Help</button>
            <button className="avatar topbar-avatar" aria-label="Sign out" type="button" onClick={() => void handleSignOut()}>{user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</button>
          </div>
        </header>

        {serviceError && <div className="storage-message" role="status">{serviceError}</div>}
        {view === "ride" && (
          <section className="page-content ride-page">
            <div className="page-heading">
              <div><span className="eyebrow">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</span><h1>Where to, {user.name.split(/\s+/)[0]}?</h1><p>Your city, your pace. Let’s get you there.</p></div>
              <button className="outline-button schedule-button" type="button" onClick={() => setToast("Scheduled rides are coming soon.")}><CalendarDays size={17} /> Schedule <span className="new-pill">NEW</span></button>
            </div>
            <div className="ride-layout">
              <div className="map-panel">
                <MapIllustration hasRoute={Boolean(destination.trim() || booking)} />
                <button className="map-location-button" type="button" onClick={useMyLocation} aria-label="Use my current location"><LocateFixed size={18} /></button>
                <div className="map-legend"><span className="legend-dot pickup-legend" /> Pickup <span className="legend-dot dropoff-legend" /> Destination</div>
                <div className="map-zoom"><button type="button" aria-label="Zoom in" onClick={() => setToast("Map zoom is not available in this preview.")}><Plus size={16} /></button><span /><button type="button" aria-label="Zoom out" onClick={() => setToast("Map zoom is not available in this preview.")}><Minus size={16} /></button></div>
                {booking?.status === "accepted" && <div className="map-driver-card"><div className="driver-car-icon"><CarFront size={20} /></div><div><strong>Driver matched</strong><span>Trip accepted · #{booking.id.slice(0, 8)}</span></div><span className="driver-pulse" /></div>}
                <div className="map-attribution">{activeQuote?.provider === "mapbox" ? "Illustrated map · route estimate by Mapbox" : "Illustrated map · route estimate is not live"}</div>
              </div>

              <div className="booking-panel">
                {booking ? (
                  <ActiveRide booking={booking} isDriver={false} onCancel={cancelBooking} onMessage={() => setToast("Driver messaging is not connected yet.")} />
                ) : (
                  <>
                    <div className="booking-panel-heading"><h2>Plan your ride</h2><span className="secure-label"><ShieldCheck size={14} /> Demo service</span></div>
                    <div className="route-inputs">
                      <div className="route-rail"><span className="route-origin" /><span className="route-line" /><span className="route-destination" /></div>
                      <div className="route-fields">
                        <label className="route-field"><span>Pickup</span><input aria-label="Pickup location" value={pickup} onChange={(event) => { setPickup(event.target.value); setQuote(null); }} /><button type="button" aria-label="Use current location" onClick={useMyLocation}><LocateFixed size={16} /></button></label>
                        <div className="field-divider" />
                        <label className={`route-field destination-field ${destinationFocused ? "field-focused" : ""}`}><span>Drop-off</span><input aria-label="Destination" placeholder="Where are you going?" value={destination} onFocus={() => setDestinationFocused(true)} onChange={(event) => { setDestination(event.target.value); setQuote(null); }} onKeyDown={(event) => { if (event.key === "Enter") setDestinationFocused(false); }} /><button type="button" aria-label="Swap pickup and drop-off" onClick={() => { setDestination(pickup); setPickup(destination || "Current location"); setQuote(null); }}><ArrowDownUp size={16} /></button></label>
                      </div>
                    </div>
                    {destinationFocused && destination.trim() && (
                      <div className="suggestion-list">
                        {suggestions.filter((place) => place.name.toLowerCase().includes(destination.toLowerCase()) || place.address.toLowerCase().includes(destination.toLowerCase())).slice(0, 3).map((place) => (
                          <button type="button" className="suggestion-item" key={place.name} onMouseDown={(event) => event.preventDefault()} onClick={() => { setDestination(place.address); setQuote(null); setDestinationFocused(false); }}>
                            <span className="suggestion-icon"><place.icon size={16} /></span><span><strong>{place.name}</strong><small>{place.address}</small></span><ArrowUpRight size={15} />
                          </button>
                        ))}
                        {suggestions.every((place) => !place.name.toLowerCase().includes(destination.toLowerCase()) && !place.address.toLowerCase().includes(destination.toLowerCase())) && (
                          <button type="button" className="suggestion-item" onClick={() => setDestinationFocused(false)}><span className="suggestion-icon"><MapPin size={16} /></span><span><strong>Use “{destination}”</strong><small>Search this destination</small></span><ArrowRight size={15} /></button>
                        )}
                      </div>
                    )}
                    <div className="section-rule" />
                    <div className="ride-options-heading"><div><h3>Choose your ride</h3><span>{activeQuote ? `${(activeQuote.distanceMeters / 1000).toFixed(1)} km · ${Math.ceil(activeQuote.durationSeconds / 60)} min route` : "Get a fare quote before requesting"}</span></div><button className="text-button" type="button" onClick={() => setToast("The demo fare is illustrative. Live pricing requires a verified route and configured business rates.")}>How pricing works</button></div>
                    <div className="ride-options">
                      {options.map(({ kind, description, icon: Icon }) => (
                        <button className={`ride-option ${selectedKind === kind ? "ride-option-selected" : ""}`} key={kind} onClick={() => { setSelectedKind(kind); setQuote(null); }} type="button" aria-pressed={selectedKind === kind}>
                          <span className="option-car"><Icon size={22} strokeWidth={1.7} /></span>
                          <span className="option-info"><strong>{kind}</strong><small>{description}</small><small className="option-eta"><Clock3 size={12} /> {activeQuote?.kind === kind ? `${Math.ceil(activeQuote.durationSeconds / 60)} min route` : "Fare quote required"}</small></span>
                          <span className="option-price">{activeQuote?.kind === kind ? formatMoney(activeQuote.fareCents) : "Quote"}</span>
                          <span className="radio-mark">{selectedKind === kind && <span />}</span>
                        </button>
                      ))}
                    </div>
                    <div className="payment-row"><span className="payment-icon"><WalletCards size={16} /></span><span>Customer wallet · {formatMoney(walletState?.balances.customerCents ?? 0)} available</span><button type="button" onClick={() => chooseView("wallet")}>Wallet</button></div>
                    <button className="request-button" type="button" onClick={() => void requestRide()} disabled={actionBusy}>
                      {actionBusy ? (activeQuote ? "Sending request…" : "Getting quote…") : activeQuote ? `Request ${selectedKind}` : "Get fare quote"}
                      {activeQuote && <span>{formatMoney(activeQuote.fareCents)}</span>}<ArrowRight size={17} />
                    </button>
                    <p className="terms-note">{activeQuote ? `Quote expires ${new Date(activeQuote.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Customer wallet is charged only after driver acceptance.` : "A fare quote is required. Demo quotes do not move real money."}</p>
                  </>
                )}
              </div>
            </div>
            <div className="trust-row"><div><ShieldCheck size={18} /><span><strong>Fare shown up front</strong><small>Review the quote before requesting</small></span></div><div><Clock3 size={18} /><span><strong>Driver acceptance required</strong><small>No charge before a driver accepts</small></span></div><div><WalletCards size={18} /><span><strong>Demo ledger only</strong><small>No real payments are processed</small></span></div><button type="button" onClick={() => setToast("To register as a driver, sign out and choose the driver account type.")}>Want to drive with us? <ArrowRight size={14} /></button></div>
          </section>
        )}

        {view === "activity" && <ActivityPage history={history} onBook={() => chooseView(user.role === "driver" ? "drive" : "ride")} />}
        {view === "wallet" && walletState && <WalletPage walletState={walletState} role={user.role} demoTopUps={appConfig?.demoTopUps ?? false} onAddFunds={addDemoFunds} />}
        {view === "drive" && user.role === "driver" && (
          <DrivePage
            online={driverOnline}
            status={user.driverStatus}
            activeTrip={booking?.status === "accepted" ? booking : null}
            requests={availableTrips}
            onToggle={() => void toggleDriverOnline()}
            onRefresh={() => void refreshDriverRequests()}
            onAccept={(trip) => void acceptDriverTrip(trip)}
            onCancel={() => void cancelBooking()}
            onComplete={() => void completeBooking()}
          />
        )}

        <footer className="footer"><span>© 2026 UnionDrive #16</span><span><button type="button" onClick={() => setToast("Privacy policy coming soon.")}>Privacy</button><button type="button" onClick={() => setToast("Terms coming soon.")}>Terms</button><span>Made for the ride ahead <span className="footer-heart">♥</span></span></span></footer>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map(({ id, icon: Icon }) => <button key={id} type="button" className={view === id ? "mobile-nav-active" : ""} onClick={() => chooseView(id)}><Icon size={19} /><span>{id === "activity" ? "Rides" : id === "drive" ? "Drive" : id === "wallet" ? "Wallet" : "Ride"}</span></button>)}
      </nav>
      {toast && <div className="toast" role="status"><span className="toast-check"><Check size={15} /></span>{toast}<button type="button" aria-label="Dismiss notification" onClick={() => setToast("")}><X size={15} /></button></div>}
    </div>
  );
}

function MapIllustration({ hasRoute }: { hasRoute: boolean }) {
  return (
    <svg className="map-illustration" viewBox="0 0 760 640" role="img" aria-label="Illustrated map of San Francisco showing the ride route">
      <defs>
        <pattern id="park-dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#bdcad7" /></pattern>
        <filter id="pin-shadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#353c43" floodOpacity=".18" /></filter>
      </defs>
      <rect width="760" height="640" fill="#e6eaed" />
      <path d="M-20 0h226l-28 97-95 34-103-27zM546 0h214v164l-114-16-67-61zM0 430l142-42 107 52 13 200H0zM594 496l166-49v193H576z" fill="#d6dee6" />
      <path d="M-20 0h226l-28 97-95 34-103-27zM546 0h214v164l-114-16-67-61zM0 430l142-42 107 52 13 200H0zM594 496l166-49v193H576z" fill="url(#park-dots)" opacity=".8" />
      <path d="M-10 207c139-19 241-10 356 11s235 31 428-8M-10 311c155-18 257-1 365 14 132 18 261 14 416-9M-14 399c151-25 279-4 379 7 125 15 244 9 412-11M178-10c-20 105-18 216-4 318 14 101 12 213-5 342M316-10c-13 100-9 187 4 282 12 93 17 232 6 378M466-10c-8 106-12 209-3 321 9 109 9 222 0 339M608-10c-19 115-19 214-10 323 9 115 6 225-9 337" fill="none" stroke="#fff" strokeWidth="17" strokeLinecap="round" />
      <path d="M-10 207c139-19 241-10 356 11s235 31 428-8M-10 311c155-18 257-1 365 14 132 18 261 14 416-9M-14 399c151-25 279-4 379 7 125 15 244 9 412-11M178-10c-20 105-18 216-4 318 14 101 12 213-5 342M316-10c-13 100-9 187 4 282 12 93 17 232 6 378M466-10c-8 106-12 209-3 321 9 109 9 222 0 339M608-10c-19 115-19 214-10 323 9 115 6 225-9 337" fill="none" stroke="#d3d7db" strokeWidth="1.5" />
      <path d="M-20 85 770 535M-20 538 770 126" fill="none" stroke="#fff" strokeWidth="8" opacity=".8" />
      <path d="M-20 85 770 535M-20 538 770 126" fill="none" stroke="#d3d7db" strokeWidth="1" />
      <path d="M0 560c117-27 192-67 274-121s129-109 199-195c65-79 129-124 287-174" fill="none" stroke="#bdd5e7" strokeWidth="22" opacity=".78" />
      <path d="M0 560c117-27 192-67 274-121s129-109 199-195c65-79 129-124 287-174" fill="none" stroke="#f8fafb" strokeWidth="2" opacity=".75" />
      <text x="54" y="185" className="map-label">PACIFIC HEIGHTS</text><text x="275" y="128" className="map-label">NOB HILL</text><text x="500" y="238" className="map-label">CHINATOWN</text><text x="282" y="494" className="map-label">CASTRO</text><text x="540" y="410" className="map-label">SOUTH BEACH</text>
      <text x="99" y="334" className="street-label">VAN NESS AVE</text><text x="398" y="568" className="street-label">MARKET ST</text><text x="636" y="282" className="street-label">COLUMBUS AVE</text>
      {hasRoute && <><path d="M184 382c70-4 104 42 174 38 51-3 73-64 132-75 51-10 77 18 130-16" fill="none" stroke="#2c3b4a" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 0" opacity=".86" /><path d="M184 382c70-4 104 42 174 38 51-3 73-64 132-75 51-10 77 18 130-16" fill="none" stroke="#c8e5ff" strokeWidth="2.5" strokeLinecap="round" /></>}
      <g transform="translate(184 382)" filter="url(#pin-shadow)"><circle r="16" fill="#fff" /><circle r="8" fill="#2c3b4a" /><circle r="3" fill="#c8e5ff" /></g>
      {hasRoute && <g transform="translate(620 329)" filter="url(#pin-shadow)"><path d="M0-22c-11 0-19 8-19 19 0 14 19 32 19 32S19 11 19-3C19-14 11-22 0-22Z" fill="#a9c7e4" /><circle cy="-3" r="6" fill="#2c3b4a" /></g>}
      {!hasRoute && <g transform="translate(537 283)"><circle r="30" fill="#fff" opacity=".78" /><circle r="20" fill="#c8e5ff" opacity=".72" /><path d="m-7 1 5 5L8-6" fill="none" stroke="#2c3b4a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></g>}
    </svg>
  );
}

function ActiveRide({ booking, isDriver, onCancel, onComplete, onMessage }: {
  booking: Booking;
  isDriver: boolean;
  onCancel: () => void;
  onComplete?: () => void;
  onMessage: () => void;
}) {
  const kindIcon = booking.kind === "XL" ? UsersRound : CarFront;
  const Icon = kindIcon;
  const accepted = booking.status === "accepted";
  return (
    <div className="active-ride">
      <div className="booking-panel-heading"><h2>{isDriver ? "Assigned trip" : "Your ride"}</h2><span className="live-pill"><span /> {accepted ? "DRIVER ACCEPTED" : "WAITING FOR DRIVER"}</span></div>
      <div className="active-status"><span className="status-icon">{accepted ? <Check size={18} /> : <Clock3 size={18} />}</span><div><strong>{accepted ? (isDriver ? "You accepted this ride" : "Your driver accepted") : "Finding a driver"}</strong><span>{accepted ? (isDriver ? "Fare was charged at acceptance." : "Your accepted fare is now locked.") : "The customer wallet has not been charged."}</span></div></div>
      {accepted && isDriver && <div className="driver-profile"><div className="driver-avatar"><UserRound size={25} /></div><div className="driver-detail"><strong>Rider pickup</strong><span>Trip ID · {booking.id.slice(0, 8)}</span></div><button type="button" className="message-button" onClick={onMessage} aria-label="Message rider"><MessageCircle size={17} /></button></div>}
      {accepted && !isDriver && <div className="vehicle-card"><div className="vehicle-icon"><Icon size={27} /></div><div><strong>Driver matched</strong><span>Trip ID · {booking.id.slice(0, 8)}</span></div><span className="vehicle-kind">{booking.kind}</span></div>}
      <div className="trip-summary"><div className="summary-point"><span className="summary-dot" /><span><small>PICKUP</small><strong>{booking.pickup}</strong></span></div><div className="summary-route" /><div className="summary-point"><span className="summary-pin"><MapPin size={14} /></span><span><small>DROP-OFF</small><strong>{booking.destination}</strong></span></div></div>
      <div className="fare-row"><span>{accepted ? "Accepted fare" : "Quoted fare"} <small> · {booking.kind}</small></span><strong>${booking.price.toFixed(2)}</strong></div>
      {accepted && <div className="fare-split">
        <div><span className="split-marker split-customer" /><span>Customer wallet pays 100%<small>Charged at driver acceptance</small></span><strong>{formatMoney(Math.round(booking.price * 100))}</strong></div>
        <div><span className="split-marker split-driver" /><span>Driver wallet receives 80%<small>Paid through Union Wallet</small></span><strong>{formatMoney(booking.driverPayoutCents)}</strong></div>
        <div><span className="split-marker split-union" /><span>Union Wallet keeps 20%<small>Platform share of accepted fare</small></span><strong>{formatMoney(booking.unionShareCents)}</strong></div>
      </div>}
      {accepted && <p className="accepted-fare-note">Fare accepted {new Date(booking.acceptedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. Payment status: {booking.paymentStatus}.</p>}
      <div className="active-actions">
        <button className="outline-button" type="button" onClick={onCancel}><X size={16} /> Cancel {booking.status === "requested" ? "request" : "trip"}</button>
        {isDriver && accepted && onComplete && <button className="complete-button" type="button" onClick={onComplete}>Complete trip <ArrowRight size={16} /></button>}
      </div>
      <p className="demo-caption">{accepted ? "Demo mode: this is a simulated payment ledger; no real money moves." : "This request is not yet a booking. A driver must accept before payment."}</p>
    </div>
  );
}

function ActivityPage({ history, onBook }: { history: Booking[]; onBook: () => void }) {
  return (
    <section className="page-content secondary-page">
      <div className="page-heading"><div><span className="eyebrow">YOUR JOURNEYS</span><h1>Ride history</h1><p>All your trips, together in one place.</p></div><button className="outline-button schedule-button" type="button" onClick={onBook}><Plus size={16} /> Book a ride</button></div>
      <div className="content-card history-card">
        <div className="card-title-row"><div><h2>Recent rides</h2><p>{history.length ? `${history.length} ${history.length === 1 ? "ride" : "rides"} on this device` : "Your ride history will show up here."}</p></div><span className="history-period">ALL TIME <ChevronDown size={14} /></span></div>
        {history.length === 0 ? <div className="empty-state"><div className="empty-icon"><CarFront size={26} /></div><h3>No trips yet</h3><p>Your trip activity will appear here.</p><button className="request-button empty-cta" type="button" onClick={onBook}>Book a ride <ArrowRight size={16} /></button></div> : <div className="history-list">{history.map((item) => <div className="history-item" key={item.id}><div className="history-car"><CarFront size={20} /></div><div className="history-destination"><strong>{item.destination}</strong><span>{item.pickup} <ArrowRight size={12} /> {new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span></div><div className="history-kind">{item.kind}</div><div className="history-price">${item.price.toFixed(2)}</div><span className={`history-status status-${item.status}`}>{item.status}</span></div>)}</div>}
      </div>
    </section>
  );
}

function WalletPage({ walletState, role, demoTopUps, onAddFunds }: {
  walletState: WalletState;
  role: AccountRole;
  demoTopUps: boolean;
  onAddFunds: (amountCents: number) => void;
}) {
  const { balances, transactions } = walletState;
  const accounts: Array<{ key: "customer" | "union" | "driver"; title: string; subtitle: string; balance: number | undefined; icon: typeof WalletCards }> = [
    { key: "customer", title: "Customer Wallet", subtitle: role === "rider" ? "Pays 100% of your accepted ride fare" : "Available only to the rider account holder", balance: balances.customerCents, icon: UserRound },
    { key: "union", title: "Union Wallet", subtitle: "Union share attributed to your trips; not platform-wide funds", balance: balances.unionCents, icon: WalletCards },
    { key: "driver", title: "Driver Wallet", subtitle: role === "driver" ? "Receives 80% of your accepted fares" : "Available only to the driver account holder", balance: balances.driverCents, icon: CarFront },
  ];

  return (
    <section className="page-content secondary-page">
      <div className="page-heading"><div><span className="eyebrow">PAYMENTS &amp; RIDE EARNINGS</span><h1>Three wallets. One ride.</h1><p>Customer payments flow through Union Wallet to the driver.</p></div></div>
      <div className="wallet-accounts">
        {accounts.map(({ key, title, subtitle, balance, icon: Icon }) => (
          <div className={`wallet-account wallet-account-${key}`} key={key}>
            <div className="wallet-account-heading"><span className="wallet-account-icon"><Icon size={18} /></span><span className="wallet-account-title">{title}</span><span className="wallet-account-tag">{key === "customer" ? "PAYER" : key === "union" ? "PLATFORM" : "EARNINGS"}</span></div>
            <strong className="wallet-balance">{balance === undefined ? "—" : formatMoney(balance)}</strong>
            <p>{subtitle}</p>
            {key === "customer" && role === "rider" && demoTopUps && <div className="top-up-actions"><button type="button" onClick={() => onAddFunds(2500)}><Plus size={14} /> Add $25 demo funds</button><button type="button" onClick={() => onAddFunds(5000)}><Plus size={14} /> Add $50</button></div>}
            {key === "union" && <div className="wallet-account-foot"><ArrowDownUp size={13} /> Receives 100%, routes 80% to driver</div>}
            {key === "driver" && <div className="wallet-account-foot"><ArrowUpRight size={13} /> 80% payout from accepted fares</div>}
          </div>
        ))}
      </div>
      <div className="wallet-detail-grid">
        <div className="content-card wallet-flow-card">
          <div className="card-title-row"><div><h2>How a ride payment works</h2><p>Split is calculated from the exact fare the driver accepts.</p></div><ShieldCheck size={19} /></div>
          <div className="wallet-flow">
            <div className="flow-step"><span className="flow-number">1</span><span className="flow-copy"><strong>Customer pays 100%</strong><small>Full accepted fare leaves Customer Wallet.</small></span><span className="flow-amount">100%</span></div>
            <div className="flow-connector" />
            <div className="flow-step"><span className="flow-number">2</span><span className="flow-copy"><strong>Union Wallet routes the payment</strong><small>Union Wallet receives the full fare and processes the split.</small></span><span className="flow-amount">100%</span></div>
            <div className="flow-split"><div><span className="flow-branch driver-branch" /><span className="flow-branch-copy"><strong>Driver Wallet</strong><small>Driver earns</small></span><b>80%</b></div><div><span className="flow-branch union-branch" /><span className="flow-branch-copy"><strong>Union Wallet</strong><small>Union retains</small></span><b>20%</b></div></div>
          </div>
          <p className="wallet-demo-note"><CircleHelp size={14} /> Demo ledger is server-owned for this local app. No real money or payment provider is connected.</p>
        </div>
        <div className="content-card wallet-history-card">
          <div className="card-title-row"><div><h2>Wallet activity</h2><p>Payments and payouts across all three wallets.</p></div></div>
          {transactions.length === 0 ? <div className="wallet-empty"><div className="empty-icon"><WalletCards size={23} /></div><strong>No wallet activity yet</strong><span>Accepted rides and demo top-ups appear here.</span></div> : <div className="wallet-transactions">{transactions.slice(0, 10).map((transaction) => {
            const accountName = transaction.wallet === "customer" ? "Customer" : transaction.wallet === "union" ? "Union" : "Driver";
            return <div className="wallet-transaction" key={transaction.id}><span className={`transaction-icon transaction-${transaction.wallet}`}>{transaction.direction === "in" ? <ArrowDownUp size={14} /> : <ArrowUpRight size={14} />}</span><span className="transaction-copy"><strong>{transaction.description}</strong><small>{accountName} Wallet · {new Date(transaction.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span><span className={`transaction-amount transaction-${transaction.direction}`}>{transaction.direction === "in" ? "+" : "−"}{formatMoney(transaction.amountCents)}</span></div>;
          })}</div>}
        </div>
      </div>
    </section>
  );
}

function DrivePage({ online, status, activeTrip, requests, onToggle, onRefresh, onAccept, onCancel, onComplete }: {
  online: boolean;
  status: DriverStatus;
  activeTrip: Booking | null;
  requests: Booking[];
  onToggle: () => void;
  onRefresh: () => void;
  onAccept: (trip: Booking) => void;
  onCancel: () => void;
  onComplete: () => void;
}) {
  const verified = status === "verified";
  return (
    <section className="page-content secondary-page drive-page">
      <div className="page-heading"><div><span className="eyebrow">DRIVE WITH UNIONDRIVE</span><h1>Your drive. Your day.</h1><p>Driver accounts require manual verification before they can accept trips.</p></div><button className={`driver-toggle ${online ? "driver-toggle-on" : ""}`} onClick={onToggle} type="button" disabled={!verified}><span className="toggle-indicator" />{online ? "You're online" : "Go online"}</button></div>
      {!verified && <div className="driver-note"><ShieldCheck size={17} /><span><strong>{status === "rejected" ? "Driver application needs review." : "Driver verification is pending."}</strong> A verified operator must approve identity, license, insurance, and vehicle documents before online access.</span></div>}
      {activeTrip && <div className="content-card active-driver-trip"><ActiveRide booking={activeTrip} isDriver onCancel={onCancel} onComplete={onComplete} onMessage={() => undefined} /></div>}
      <div className="driver-requests content-card">
        <div className="card-title-row"><div><h2>Available trip requests</h2><p>{online && verified ? "Requests are shown from the server. No location matching is configured." : "Verify your account and go online to view requests."}</p></div><button className="outline-button" type="button" disabled={!online || !verified} onClick={onRefresh}>Refresh requests</button></div>
        {!online || !verified ? <div className="wallet-empty"><div className="empty-icon"><CarFront size={23} /></div><strong>Not available yet</strong><span>Driver verification and online status are required.</span></div> : requests.length === 0 ? <div className="wallet-empty"><div className="empty-icon"><CarFront size={23} /></div><strong>No requests right now</strong><span>New requests will appear when riders submit one.</span></div> : <div className="request-list">{requests.map((trip) => <div className="request-card" key={trip.id}><div className="request-route"><span><small>PICKUP</small><strong>{trip.pickup}</strong></span><ArrowRight size={15} /><span><small>DROP-OFF</small><strong>{trip.destination}</strong></span></div><div className="request-fare"><span>{trip.kind} · {trip.eta} min</span><strong>{formatMoney(Math.round(trip.price * 100))}</strong><small>Your 80% share: {formatMoney(trip.driverPayoutCents)}</small></div><button className="request-accept" type="button" onClick={() => onAccept(trip)}>Accept at quoted fare <Check size={15} /></button></div>)}</div>}
      </div>
      <div className="driver-stats"><div><span className="stat-icon"><WalletCards size={18} /></span><span><small>YOUR EARNINGS</small><strong>—</strong><em>See wallet for ledger balance</em></span></div><div><span className="stat-icon"><CarFront size={18} /></span><span><small>COMPLETED RIDES</small><strong>—</strong><em>Trip history</em></span></div><div><span className="stat-icon"><Star size={18} /></span><span><small>DRIVER RATING</small><strong>—</strong><em>Ratings not implemented</em></span></div><div><span className={`online-indicator ${online ? "online-indicator-active" : ""}`} /><span><small>DRIVER STATUS</small><strong>{online ? "Online" : "Offline"}</strong><em>{verified ? (online ? "Available for requests" : "Go online to see requests") : "Verification required"}</em></span></div></div>
    </section>
  );
}

function LoadingScreen({ darkMode }: { darkMode: boolean }) {
  return (
    <main className={`auth-shell ${darkMode ? "auth-dark" : ""}`}>
      <div className="auth-loading" role="status" aria-live="polite">
        <span className="brand-mark">U<span>.</span></span>
        <strong>UnionDrive<span className="brand-number">#16</span></strong>
        <span className="loading-indicator" />
        <span>Connecting securely…</span>
      </div>
    </main>
  );
}

function AuthScreen({ darkMode, error, loading, onSubmit, onToggleTheme }: {
  darkMode: boolean;
  error: string;
  loading: boolean;
  onSubmit: (mode: "signin" | "signup", input: { name: string; email: string; password: string; role: AccountRole }) => void;
  onToggleTheme: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AccountRole>("rider");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(mode, { name, email, password, role });
  };

  return (
    <main className={`auth-shell ${darkMode ? "auth-dark" : ""}`}>
      <button className="auth-theme-toggle" type="button" onClick={onToggleTheme} aria-label={darkMode ? "Use light mode" : "Use dark mode"}>
        {darkMode ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="brand auth-brand" href="#" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark">U<span>.</span></span>
          <span className="brand-name">UnionDrive<span className="brand-number">#16</span></span>
        </a>
        <span className="eyebrow">YOUR NEXT RIDE STARTS HERE</span>
        <h1 id="auth-title">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-intro">{mode === "signup" ? "Sign up to request rides or join as a driver." : "Sign in to continue to UnionDrive."}</p>
        <div className="auth-mode-tabs" role="tablist" aria-label="Account action">
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "auth-tab-active" : ""} onClick={() => setMode("signup")}>Create account</button>
          <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "auth-tab-active" : ""} onClick={() => setMode("signin")}>Sign in</button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && <>
            <label htmlFor="auth-name">Full name</label>
            <input id="auth-name" autoComplete="name" maxLength={80} minLength={2} required value={name} onChange={(event) => setName(event.target.value)} />
            <label htmlFor="auth-role">Account type</label>
            <select id="auth-role" value={role} onChange={(event) => setRole(event.target.value === "driver" ? "driver" : "rider")}>
              <option value="rider">Rider</option>
              <option value="driver">Driver (verification required)</option>
            </select>
          </>}
          <label htmlFor="auth-email">Email address</label>
          <input id="auth-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="auth-password">Password</label>
          <input id="auth-password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 1} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} />
          {mode === "signup" && <small className="auth-field-hint">Use at least 12 characters. Driver accounts stay offline until manually verified.</small>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>{loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"} <ArrowRight size={17} /></button>
        </form>
        <p className="auth-demo-note"><ShieldCheck size={15} /> Demo service only. No real rides or payments are processed.</p>
      </section>
    </main>
  );
}

export default App;

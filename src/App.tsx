import { useEffect, useMemo, useState } from "react";
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

type View = "ride" | "activity" | "wallet" | "drive";
type RideKind = "Everyday" | "Comfort" | "XL";
type BookingStatus = "confirmed" | "cancelled" | "completed";

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
  status: BookingStatus;
};

type StoredBooking = Omit<Booking, "acceptedAt" | "driverPayoutCents" | "unionShareCents"> &
  Partial<Pick<Booking, "acceptedAt" | "driverPayoutCents" | "unionShareCents">>;
type WalletKey = "customer" | "union" | "driver";
type WalletTransaction = {
  id: string;
  rideId?: string;
  createdAt: string;
  wallet: WalletKey;
  direction: "in" | "out";
  amountCents: number;
  description: string;
};
type WalletBalances = { customerCents: number; unionCents: number; driverCents: number };
type WalletState = { balances: WalletBalances; transactions: WalletTransaction[] };

const STORAGE_KEY = "uniondrive16.bookings";
const WALLETS_STORAGE_KEY = "uniondrive16.wallets";
const THEME_STORAGE_KEY = "uniondrive16.theme";
const INITIAL_WALLET_STATE: WalletState = {
  balances: { customerCents: 25_000, unionCents: 0, driverCents: 0 },
  transactions: [],
};

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

function isBooking(value: unknown): value is StoredBooking {
  if (typeof value !== "object" || value === null) return false;
  const booking = value as Record<string, unknown>;
  return (
    typeof booking.id === "string" &&
    typeof booking.destination === "string" &&
    typeof booking.pickup === "string" &&
    (booking.kind === "Everyday" || booking.kind === "Comfort" || booking.kind === "XL") &&
    typeof booking.price === "number" &&
    typeof booking.eta === "number" &&
    typeof booking.createdAt === "string" &&
    (booking.status === "confirmed" || booking.status === "cancelled" || booking.status === "completed")
  );
}

function normalizeBooking(booking: StoredBooking): Booking {
  const totalCents = Math.round(booking.price * 100);
  const driverPayoutCents =
    typeof booking.driverPayoutCents === "number" && Number.isSafeInteger(booking.driverPayoutCents)
      ? booking.driverPayoutCents
      : Math.round(totalCents * 0.8);
  return {
    ...booking,
    acceptedAt: booking.acceptedAt ?? booking.createdAt,
    driverPayoutCents,
    unionShareCents:
      typeof booking.unionShareCents === "number" && Number.isSafeInteger(booking.unionShareCents)
        ? booking.unionShareCents
        : totalCents - driverPayoutCents,
  };
}

function getStoredBookings(): Booking[] {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return [];
  const parsed: unknown = JSON.parse(saved);
  return Array.isArray(parsed) ? parsed.filter(isBooking).map(normalizeBooking) : [];
}

function isWalletTransaction(value: unknown): value is WalletTransaction {
  if (typeof value !== "object" || value === null) return false;
  const transaction = value as Record<string, unknown>;
  return (
    typeof transaction.id === "string" &&
    typeof transaction.createdAt === "string" &&
    (transaction.wallet === "customer" || transaction.wallet === "union" || transaction.wallet === "driver") &&
    (transaction.direction === "in" || transaction.direction === "out") &&
    typeof transaction.amountCents === "number" &&
    Number.isSafeInteger(transaction.amountCents) &&
    transaction.amountCents >= 0 &&
    typeof transaction.description === "string"
  );
}

function isWalletState(value: unknown): value is WalletState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  if (typeof state.balances !== "object" || state.balances === null || !Array.isArray(state.transactions)) return false;
  const balances = state.balances as Record<string, unknown>;
  return (
    ["customerCents", "unionCents", "driverCents"].every(
      (key) => typeof balances[key] === "number" && Number.isSafeInteger(balances[key]) && (balances[key] as number) >= 0,
    ) && state.transactions.every(isWalletTransaction)
  );
}

function getStoredWalletState(): WalletState {
  const saved = window.localStorage.getItem(WALLETS_STORAGE_KEY);
  if (!saved) return INITIAL_WALLET_STATE;
  const parsed: unknown = JSON.parse(saved);
  if (!isWalletState(parsed)) throw new Error("Saved wallet data is invalid.");
  return parsed;
}

function createTransaction(
  wallet: WalletKey,
  direction: "in" | "out",
  amountCents: number,
  description: string,
  rideId?: string,
): WalletTransaction {
  return { id: crypto.randomUUID(), wallet, direction, amountCents, description, rideId, createdAt: new Date().toISOString() };
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function estimateFare(basePrice: number, destination: string) {
  const distanceFactor = Math.min(Math.max(destination.trim().length / 12, 1), 2.8);
  return Math.round((basePrice * distanceFactor + 2.5) * 100) / 100;
}

function App() {
  const [view, setView] = useState<View>("ride");
  const [destination, setDestination] = useState("");
  const [pickup, setPickup] = useState("Current location");
  const [selectedKind, setSelectedKind] = useState<RideKind>("Everyday");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [history, setHistory] = useState<Booking[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [walletState, setWalletState] = useState<WalletState>(INITIAL_WALLET_STATE);
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [driverOnline, setDriverOnline] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [destinationFocused, setDestinationFocused] = useState(false);
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    try {
      const saved = getStoredBookings();
      setHistory(saved);
      setBooking(saved.find((item) => item.status === "confirmed") ?? null);
    } catch {
      setStorageError("Your saved rides could not be loaded. You can still book a ride in this session.");
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    try {
      setWalletState(getStoredWalletState());
    } catch {
      setStorageError("Your saved wallet data could not be loaded. The demo wallets have been reset on this device.");
    } finally {
      setWalletLoaded(true);
    }
  }, []);

  useEffect(() => {
    try {
      setDarkMode(window.localStorage.getItem(THEME_STORAGE_KEY) === "dark");
    } catch {
      setStorageError("Your appearance preference could not be loaded.");
    } finally {
      setThemeLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      setStorageError("Ride history could not be saved on this device.");
    }
  }, [history, historyLoaded]);

  useEffect(() => {
    if (!walletLoaded) return;
    try {
      window.localStorage.setItem(WALLETS_STORAGE_KEY, JSON.stringify(walletState));
    } catch {
      setStorageError("Wallet updates could not be saved on this device.");
    }
  }, [walletState, walletLoaded]);

  useEffect(() => {
    if (!themeLoaded) return;
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", darkMode ? "#141a16" : "#f4f7fb");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
    } catch {
      setStorageError("Your appearance preference could not be saved on this device.");
    }
  }, [darkMode, themeLoaded]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedOption = options.find((option) => option.kind === selectedKind) ?? options[0];
  const price = useMemo(() => estimateFare(selectedOption.basePrice, destination), [destination, selectedOption]);

  const chooseView = (nextView: View) => {
    setView(nextView);
    setMenuOpen(false);
  };

  const updateBooking = (nextBooking: Booking) => {
    setBooking(nextBooking.status === "confirmed" ? nextBooking : null);
    setHistory((previous) => previous.map((item) => (item.id === nextBooking.id ? nextBooking : item)));
  };

  const requestRide = () => {
    const cleanDestination = destination.trim();
    if (!cleanDestination) {
      setToast("Add a destination to see your ride options.");
      return;
    }
    if (booking) {
      setToast("You already have an active ride.");
      return;
    }
    const fareCents = Math.round(price * 100);
    if (walletState.balances.customerCents < fareCents) {
      setView("wallet");
      setToast(`Your customer wallet needs ${formatMoney(fareCents - walletState.balances.customerCents)} more to cover this fare.`);
      return;
    }
    const driverPayoutCents = Math.round(fareCents * 0.8);
    const unionShareCents = fareCents - driverPayoutCents;
    const nextBooking: Booking = {
      id: crypto.randomUUID(),
      destination: cleanDestination,
      pickup,
      kind: selectedKind,
      price: fareCents / 100,
      acceptedAt: new Date().toISOString(),
      driverPayoutCents,
      unionShareCents,
      eta: selectedOption.eta,
      createdAt: new Date().toISOString(),
      status: "confirmed",
    };
    const description = `Ride fare · ${cleanDestination}`;
    setWalletState((current) => ({
      balances: {
        customerCents: current.balances.customerCents - fareCents,
        unionCents: current.balances.unionCents + unionShareCents,
        driverCents: current.balances.driverCents + driverPayoutCents,
      },
      transactions: [
        createTransaction("customer", "out", fareCents, description, nextBooking.id),
        createTransaction("union", "in", fareCents, `Customer payment · ${cleanDestination}`, nextBooking.id),
        createTransaction("union", "out", driverPayoutCents, `Driver payout (80%) · ${cleanDestination}`, nextBooking.id),
        createTransaction("driver", "in", driverPayoutCents, `Ride payout · ${cleanDestination}`, nextBooking.id),
        ...current.transactions,
      ],
    }));
    setBooking(nextBooking);
    setHistory((previous) => [nextBooking, ...previous]);
    setDestinationFocused(false);
    setToast("Driver accepted. The fare was charged and split between the wallets.");
  };

  const addDemoFunds = (amountCents: number) => {
    setWalletState((current) => ({
      balances: { ...current.balances, customerCents: current.balances.customerCents + amountCents },
      transactions: [
        createTransaction("customer", "in", amountCents, "Demo wallet top-up"),
        ...current.transactions,
      ],
    }));
    setToast(`${formatMoney(amountCents)} added to the customer wallet (demo only).`);
  };

  const cancelBooking = () => {
    if (!booking) return;
    const fareCents = Math.round(booking.price * 100);
    setWalletState((current) => ({
      balances: {
        customerCents: current.balances.customerCents + fareCents,
        unionCents: current.balances.unionCents - booking.unionShareCents,
        driverCents: current.balances.driverCents - booking.driverPayoutCents,
      },
      transactions: [
        createTransaction("customer", "in", fareCents, `Ride refund · ${booking.destination}`, booking.id),
        createTransaction("union", "out", fareCents, `Customer refund · ${booking.destination}`, booking.id),
        createTransaction("union", "in", booking.driverPayoutCents, `Payout returned · ${booking.destination}`, booking.id),
        createTransaction("driver", "out", booking.driverPayoutCents, `Payout reversal · ${booking.destination}`, booking.id),
        ...current.transactions,
      ],
    }));
    updateBooking({ ...booking, status: "cancelled" });
    setToast("Ride cancelled. The customer wallet was refunded in full.");
  };

  const completeBooking = () => {
    if (!booking) return;
    updateBooking({ ...booking, status: "completed" });
    setToast("Ride complete. Thanks for riding with us!");
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
  };

  const navItems: Array<{ id: View; label: string; icon: typeof CarFront }> = [
    { id: "ride", label: "Book a ride", icon: CarFront },
    { id: "activity", label: "Your rides", icon: Clock3 },
    { id: "wallet", label: "Wallet", icon: WalletCards },
    { id: "drive", label: "Drive with us", icon: Bike },
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); chooseView("ride"); }}>
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
          <div className="avatar">JD</div>
          <div className="profile-copy"><strong>Jordan Davis</strong><span>Rider account</span></div>
          <button className="icon-button profile-menu" aria-label="Account options" type="button" onClick={() => setToast("Signed in as Jordan Davis.")}><ChevronDown size={16} /></button>
        </div>
      </aside>

      {menuOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} type="button" />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)} type="button"><Menu size={21} /></button>
          <div className="topbar-location"><span className="location-dot" /> San Francisco, CA <ChevronDown size={14} /></div>
          <div className="topbar-actions">
            <span className="service-status"><span className="status-dot" /> All systems go</span>
            <button className="topbar-help" type="button" onClick={() => setToast("Help center coming soon.")}><CircleHelp size={17} /> Help</button>
            <button className="avatar topbar-avatar" aria-label="Your profile" type="button" onClick={() => setToast("Signed in as Jordan Davis.")}>JD</button>
          </div>
        </header>

        {storageError && <div className="storage-message" role="status">{storageError}</div>}
        {view === "ride" && (
          <section className="page-content ride-page">
            <div className="page-heading">
              <div><span className="eyebrow">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</span><h1>Where to, Jordan?</h1><p>Your city, your pace. Let’s get you there.</p></div>
              <button className="outline-button schedule-button" type="button" onClick={() => setToast("Scheduled rides are coming soon.")}><CalendarDays size={17} /> Schedule <span className="new-pill">NEW</span></button>
            </div>
            <div className="ride-layout">
              <div className="map-panel">
                <MapIllustration hasRoute={Boolean(destination.trim() || booking)} />
                <button className="map-location-button" type="button" onClick={useMyLocation} aria-label="Use my current location"><LocateFixed size={18} /></button>
                <div className="map-legend"><span className="legend-dot pickup-legend" /> Pickup <span className="legend-dot dropoff-legend" /> Destination</div>
                <div className="map-zoom"><button type="button" aria-label="Zoom in" onClick={() => setToast("Map zoom is not available in this preview.")}><Plus size={16} /></button><span /><button type="button" aria-label="Zoom out" onClick={() => setToast("Map zoom is not available in this preview.")}><Minus size={16} /></button></div>
                {booking && <div className="map-driver-card"><div className="driver-car-icon"><CarFront size={20} /></div><div><strong>Alex is on the way</strong><span>Silver Toyota Prius · 4 min away</span></div><span className="driver-pulse" /></div>}
                <div className="map-attribution">Map preview · San Francisco</div>
              </div>

              <div className="booking-panel">
                {booking ? (
                  <ActiveRide booking={booking} onCancel={cancelBooking} onComplete={completeBooking} onMessage={() => setToast("Messaging will be available when driver chat is connected.")} />
                ) : (
                  <>
                    <div className="booking-panel-heading"><h2>Plan your ride</h2><span className="secure-label"><ShieldCheck size={14} /> Safe &amp; reliable</span></div>
                    <div className="route-inputs">
                      <div className="route-rail"><span className="route-origin" /><span className="route-line" /><span className="route-destination" /></div>
                      <div className="route-fields">
                        <label className="route-field"><span>Pickup</span><input aria-label="Pickup location" value={pickup} onChange={(event) => setPickup(event.target.value)} /><button type="button" aria-label="Use current location" onClick={useMyLocation}><LocateFixed size={16} /></button></label>
                        <div className="field-divider" />
                        <label className={`route-field destination-field ${destinationFocused ? "field-focused" : ""}`}><span>Drop-off</span><input aria-label="Destination" placeholder="Where are you going?" value={destination} onFocus={() => setDestinationFocused(true)} onChange={(event) => setDestination(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setDestinationFocused(false); }} /><button type="button" aria-label="Swap pickup and drop-off" onClick={() => { setDestination(pickup); setPickup(destination || "Current location"); }}><ArrowDownUp size={16} /></button></label>
                      </div>
                    </div>
                    {destinationFocused && destination.trim() && (
                      <div className="suggestion-list">
                        {suggestions.filter((place) => place.name.toLowerCase().includes(destination.toLowerCase()) || place.address.toLowerCase().includes(destination.toLowerCase())).slice(0, 3).map((place) => (
                          <button type="button" className="suggestion-item" key={place.name} onMouseDown={(event) => event.preventDefault()} onClick={() => { setDestination(place.address); setDestinationFocused(false); }}>
                            <span className="suggestion-icon"><place.icon size={16} /></span><span><strong>{place.name}</strong><small>{place.address}</small></span><ArrowUpRight size={15} />
                          </button>
                        ))}
                        {suggestions.every((place) => !place.name.toLowerCase().includes(destination.toLowerCase()) && !place.address.toLowerCase().includes(destination.toLowerCase())) && (
                          <button type="button" className="suggestion-item" onClick={() => setDestinationFocused(false)}><span className="suggestion-icon"><MapPin size={16} /></span><span><strong>Use “{destination}”</strong><small>Search this destination</small></span><ArrowRight size={15} /></button>
                        )}
                      </div>
                    )}
                    <div className="section-rule" />
                    <div className="ride-options-heading"><div><h3>Choose your ride</h3><span>Upfront prices · No surprises</span></div><button className="text-button" type="button" onClick={() => setToast("All ride prices include standard fees.")}>How pricing works</button></div>
                    <div className="ride-options">
                      {options.map(({ kind, description, icon: Icon, eta, basePrice }) => (
                        <button className={`ride-option ${selectedKind === kind ? "ride-option-selected" : ""}`} key={kind} onClick={() => setSelectedKind(kind)} type="button" aria-pressed={selectedKind === kind}>
                          <span className="option-car"><Icon size={22} strokeWidth={1.7} /></span>
                          <span className="option-info"><strong>{kind}</strong><small>{description}</small><small className="option-eta"><Clock3 size={12} /> {eta} min away</small></span>
                          <span className="option-price">${estimateFare(basePrice, destination).toFixed(2)}</span>
                          <span className="radio-mark">{selectedKind === kind && <span />}</span>
                        </button>
                      ))}
                    </div>
                    <div className="payment-row"><span className="payment-icon"><WalletCards size={16} /></span><span>Customer wallet · {formatMoney(walletState.balances.customerCents)} available</span><button type="button" onClick={() => chooseView("wallet")}>Add funds</button></div>
                    <button className="request-button" type="button" onClick={requestRide} disabled={!walletLoaded}>Confirm {selectedKind} <span>${price.toFixed(2)}</span><ArrowRight size={17} /></button>
                    <p className="terms-note">By confirming, you agree to our <button type="button" onClick={() => setToast("Terms and conditions coming soon.")}>Terms</button> and <button type="button" onClick={() => setToast("Privacy policy coming soon.")}>Privacy Policy</button>.</p>
                  </>
                )}
              </div>
            </div>
            <div className="trust-row"><div><ShieldCheck size={18} /><span><strong>Every ride is covered</strong><small>Safety comes standard</small></span></div><div><Star size={18} /><span><strong>Drivers you can trust</strong><small>Rated by riders like you</small></span></div><div><MessageCircle size={18} /><span><strong>Here when you need us</strong><small>Friendly support, always</small></span></div><button type="button" onClick={() => chooseView("drive")}>Want to drive with us? <ArrowRight size={14} /></button></div>
          </section>
        )}

        {view === "activity" && <ActivityPage history={history} onBook={() => chooseView("ride")} />}
        {view === "wallet" && <WalletPage walletState={walletState} onAddFunds={addDemoFunds} />}
        {view === "drive" && <DrivePage online={driverOnline} onToggle={() => { setDriverOnline((current) => !current); setToast(driverOnline ? "You are offline." : "You are online and ready for requests."); }} onToast={setToast} />}

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

function ActiveRide({ booking, onCancel, onComplete, onMessage }: { booking: Booking; onCancel: () => void; onComplete: () => void; onMessage: () => void }) {
  const kindIcon = booking.kind === "XL" ? UsersRound : CarFront;
  const Icon = kindIcon;
  return (
    <div className="active-ride">
      <div className="booking-panel-heading"><h2>Your ride</h2><span className="live-pill"><span /> DRIVER MATCHED</span></div>
      <div className="active-status"><span className="status-icon"><Check size={18} /></span><div><strong>Your driver is on the way</strong><span>Arriving in about {booking.eta} minutes</span></div></div>
      <div className="driver-profile"><div className="driver-avatar"><UserRound size={25} /></div><div className="driver-detail"><strong>Alex Morgan <span className="verified-driver"><Check size={11} /></span></strong><span><Star size={13} fill="currentColor" /> 4.98 <span className="driver-separator">·</span> 1,240 rides</span></div><button type="button" className="message-button" onClick={onMessage}><MessageCircle size={17} /></button></div>
      <div className="vehicle-card"><div className="vehicle-icon"><Icon size={27} /></div><div><strong>Silver Toyota Prius</strong><span>California · 8ABC123</span></div><span className="vehicle-kind">{booking.kind}</span></div>
      <div className="trip-summary"><div className="summary-point"><span className="summary-dot" /><span><small>PICKUP</small><strong>{booking.pickup}</strong></span></div><div className="summary-route" /><div className="summary-point"><span className="summary-pin"><MapPin size={14} /></span><span><small>DROP-OFF</small><strong>{booking.destination}</strong></span></div></div>
      <div className="fare-row"><span>Estimated total <small> · {booking.kind}</small></span><strong>${booking.price.toFixed(2)}</strong></div>
      <div className="fare-split">
        <div><span className="split-marker split-customer" /><span>Customer wallet pays 100%<small>Charged at driver acceptance</small></span><strong>{formatMoney(Math.round(booking.price * 100))}</strong></div>
        <div><span className="split-marker split-driver" /><span>Driver wallet receives 80%<small>Paid through Union Wallet</small></span><strong>{formatMoney(booking.driverPayoutCents)}</strong></div>
        <div><span className="split-marker split-union" /><span>Union Wallet keeps 20%<small>Platform share of accepted fare</small></span><strong>{formatMoney(booking.unionShareCents)}</strong></div>
      </div>
      <p className="accepted-fare-note">Accepted fare locked at {new Date(booking.acceptedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. The total will not change.</p>
      <div className="active-actions"><button className="outline-button" type="button" onClick={onCancel}><X size={16} /> Cancel ride</button><button className="complete-button" type="button" onClick={onComplete}>Complete demo ride <ArrowRight size={16} /></button></div>
      <p className="demo-caption">This is a demo ride. No driver has been dispatched.</p>
    </div>
  );
}

function ActivityPage({ history, onBook }: { history: Booking[]; onBook: () => void }) {
  return (
    <section className="page-content secondary-page">
      <div className="page-heading"><div><span className="eyebrow">YOUR JOURNEYS</span><h1>Ride history</h1><p>All your trips, together in one place.</p></div><button className="outline-button schedule-button" type="button" onClick={onBook}><Plus size={16} /> Book a ride</button></div>
      <div className="content-card history-card">
        <div className="card-title-row"><div><h2>Recent rides</h2><p>{history.length ? `${history.length} ${history.length === 1 ? "ride" : "rides"} on this device` : "Your ride history will show up here."}</p></div><span className="history-period">ALL TIME <ChevronDown size={14} /></span></div>
        {history.length === 0 ? <div className="empty-state"><div className="empty-icon"><CarFront size={26} /></div><h3>No rides yet</h3><p>Your next ride is just around the corner.</p><button className="request-button empty-cta" type="button" onClick={onBook}>Book your first ride <ArrowRight size={16} /></button></div> : <div className="history-list">{history.map((item) => <div className="history-item" key={item.id}><div className="history-car"><CarFront size={20} /></div><div className="history-destination"><strong>{item.destination}</strong><span>{item.pickup} <ArrowRight size={12} /> {new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span></div><div className="history-kind">{item.kind}</div><div className="history-price">${item.price.toFixed(2)}</div><span className={`history-status status-${item.status}`}>{item.status}</span></div>)}</div>}
      </div>
    </section>
  );
}

function WalletPage({ walletState, onAddFunds }: { walletState: WalletState; onAddFunds: (amountCents: number) => void }) {
  const { balances, transactions } = walletState;
  const accounts: Array<{ key: WalletKey; title: string; subtitle: string; balance: number; icon: typeof WalletCards }> = [
    { key: "customer", title: "Customer Wallet", subtitle: "Pays 100% of the accepted ride fare", balance: balances.customerCents, icon: UserRound },
    { key: "union", title: "Union Wallet", subtitle: "Routes every payment · keeps 20%", balance: balances.unionCents, icon: WalletCards },
    { key: "driver", title: "Driver Wallet", subtitle: "Receives 80% of each accepted fare", balance: balances.driverCents, icon: CarFront },
  ];

  return (
    <section className="page-content secondary-page">
      <div className="page-heading"><div><span className="eyebrow">PAYMENTS &amp; RIDE EARNINGS</span><h1>Three wallets. One ride.</h1><p>Customer payments flow through Union Wallet to the driver.</p></div></div>
      <div className="wallet-accounts">
        {accounts.map(({ key, title, subtitle, balance, icon: Icon }) => (
          <div className={`wallet-account wallet-account-${key}`} key={key}>
            <div className="wallet-account-heading"><span className="wallet-account-icon"><Icon size={18} /></span><span className="wallet-account-title">{title}</span><span className="wallet-account-tag">{key === "customer" ? "PAYER" : key === "union" ? "PLATFORM" : "EARNINGS"}</span></div>
            <strong className="wallet-balance">{formatMoney(balance)}</strong>
            <p>{subtitle}</p>
            {key === "customer" && <div className="top-up-actions"><button type="button" onClick={() => onAddFunds(2500)}><Plus size={14} /> Add $25 demo funds</button><button type="button" onClick={() => onAddFunds(5000)}><Plus size={14} /> Add $50</button></div>}
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
          <p className="wallet-demo-note"><CircleHelp size={14} /> Wallet balances and top-ups are simulated on this device. No real money is moved.</p>
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

function DrivePage({ online, onToggle, onToast }: { online: boolean; onToggle: () => void; onToast: (message: string) => void }) {
  return (
    <section className="page-content secondary-page drive-page">
      <div className="page-heading"><div><span className="eyebrow">DRIVE WITH UNIONDRIVE</span><h1>Your drive. Your day.</h1><p>Earn on your schedule, with support along the way.</p></div><button className={`driver-toggle ${online ? "driver-toggle-on" : ""}`} onClick={onToggle} type="button"><span className="toggle-indicator" />{online ? "You're online" : "Go online"}</button></div>
      <div className="drive-hero"><div className="drive-hero-copy"><span className="drive-badge"><Sparkles size={14} /> DRIVE ON YOUR TERMS</span><h2>Good things happen<br />when you <em>drive your way.</em></h2><p>Flexible hours, friendly riders, and earnings you can count on. Start your next chapter with UnionDrive.</p><button className="drive-cta" type="button" onClick={() => onToast("Driver onboarding will be available when identity verification is connected.")}>Get started <ArrowRight size={16} /></button><div className="driver-rating"><span className="mini-avatars"><i>JM</i><i>AL</i><i>RK</i></span><span><Star size={12} fill="currentColor" /> Loved by local drivers</span></div></div><div className="drive-art"><div className="art-sun" /><div className="art-road" /><div className="art-car"><CarFront size={79} strokeWidth={1.15} /></div><div className="art-earnings"><span><ArrowUpRight size={14} /> TODAY'S A GOOD DAY</span><strong>$186.40</strong><small>Illustrative earnings</small></div><div className="art-sparkle sparkle-one">✳</div><div className="art-sparkle sparkle-two">✳</div></div></div>
      <div className="driver-stats"><div><span className="stat-icon"><WalletCards size={18} /></span><span><small>YOUR EARNINGS</small><strong>$0.00</strong><em>Today · demo</em></span></div><div><span className="stat-icon"><CarFront size={18} /></span><span><small>COMPLETED RIDES</small><strong>0</strong><em>This week</em></span></div><div><span className="stat-icon"><Star size={18} /></span><span><small>DRIVER RATING</small><strong>—</strong><em>Build your rating</em></span></div><div><span className={`online-indicator ${online ? "online-indicator-active" : ""}`} /><span><small>DRIVER STATUS</small><strong>{online ? "Online" : "Offline"}</strong><em>{online ? "Ready for requests" : "Go online to get requests"}</em></span></div></div>
      <div className="driver-note"><ShieldCheck size={17} /><span><strong>Driver onboarding and real trip requests aren’t connected yet.</strong> This preview lets you explore the driver experience without dispatching real rides.</span></div>
    </section>
  );
}

export default App;

// Page load par check karo
window.addEventListener('load', () => {
  // Agar previous page exist nahi karta, ek dummy state add karo
  if (!document.referrer || document.referrer.indexOf(window.location.hostname) === -1) {
    history.replaceState({ fallback: true }, '');
  } else {
    // Agar pichla page same site se tha, normal history preserve hota hai
  }
});

// Back button press handle karo
window.addEventListener('popstate', (event) => {
  // Agar fallback state hai, user home page pe bhejo
  if (event.state && event.state.fallback) {
    window.location.href = '/index.html'; // Home page
  } else {
    // Agar normal history hai, browser apne aap pichle page pe le jayega
    history.back();
  }
});

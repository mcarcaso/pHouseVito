// Live timestamp functionality
function updateTimestamp() {
    const now = new Date();

    // Format the timestamp with full date and time
    const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    };

    const formattedTime = now.toLocaleDateString('en-US', options);

    // Update the timestamp element
    const timestampElement = document.getElementById('timestamp');
    if (timestampElement) {
        timestampElement.textContent = formattedTime;
    }
}

// Initialize timestamp on page load
document.addEventListener('DOMContentLoaded', function() {
    // Update immediately
    updateTimestamp();

    // Update every second
    setInterval(updateTimestamp, 1000);

    // Add some interactive effects
    const timestampContainer = document.querySelector('.timestamp-container');
    const infoCard = document.querySelector('.info-card');

    // Add click effect to timestamp
    if (timestampContainer) {
        timestampContainer.addEventListener('click', function() {
            this.style.transform = 'translateY(-5px) scale(1.05)';
            setTimeout(() => {
                this.style.transform = 'translateY(-5px) scale(1)';
            }, 200);
        });
    }

    // Add parallax-like effect to hero section on scroll
    window.addEventListener('scroll', function() {
        const scrolled = window.pageYOffset;
        const hero = document.querySelector('.hero');
        if (hero) {
            hero.style.transform = `translateY(${scrolled * 0.3}px)`;
        }
    });

    // Add loading animation
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.5s ease-in-out';

    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);
});

// Add console welcome message
console.log(`
╔══════════════════════════════════════╗
║        Battle Test - CC Harness      ║
║           Welcome Developer!         ║
╚══════════════════════════════════════╝

✨ Live timestamp updating every second
🎨 Modern responsive design
⚡ Performance optimized
🚀 Ready for battle testing!
`);

// Performance monitoring
let performanceData = {
    loadTime: performance.now(),
    interactions: 0
};

// Track user interactions
document.addEventListener('click', () => {
    performanceData.interactions++;
});

// Log performance data after 5 seconds
setTimeout(() => {
    console.log('📊 Performance Data:', {
        loadTime: `${performanceData.loadTime.toFixed(2)}ms`,
        interactions: performanceData.interactions,
        memoryUsage: performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(2)}MB` : 'Not available'
    });
}, 5000);
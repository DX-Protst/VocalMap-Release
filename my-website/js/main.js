document.addEventListener('DOMContentLoaded', () => {

    /* Loading Screen Fade Out */
    const loader = document.getElementById('loading-screen');
    if (loader) {
        const fadeOutLoader = () => {
            loader.classList.add('fade-out');
            setTimeout(() => {
                loader.remove();
            }, 800);
        };

        if (document.readyState === 'complete') {
            fadeOutLoader();
        } else {
            window.addEventListener('load', fadeOutLoader);
        }
    }

    /* Theme Toggle Logic */
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    function updateThemeIcon() {
        if (!themeIcon) return;
        if (document.documentElement.classList.contains('dark')) {
            themeIcon.classList.remove('ph-sun');
            themeIcon.classList.add('ph-moon');
        } else {
            themeIcon.classList.remove('ph-moon');
            themeIcon.classList.add('ph-sun');
        }
    }

    // Initialize icon
    updateThemeIcon();

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            updateThemeIcon();
        });
    }

    /* 3D Carousel Logic */
    const track = document.getElementById('carouselTrack');
    if (track && window.imagesData) {
        const numItems = window.imagesData.length;
        const theta = 360 / numItems;
        
        let isMobile = window.innerWidth <= 768;
        let isTablet = window.innerWidth <= 1024 && !isMobile;
        let cardWidth = isMobile ? 320 : (isTablet ? 600 : 800);
        const radius = Math.round((cardWidth / 2) / Math.tan(Math.PI / numItems)) + (isMobile ? 20 : 60); 
        
        window.imagesData.forEach((data, index) => {
            const card = document.createElement('div');
            card.className = 'carousel-card';
            const angle = theta * index;
            card.style.transform = `rotateY(${angle}deg) translateZ(${radius}px)`;
            
            const img = document.createElement('img');
            img.src = `photos/${data.src}`;
            card.appendChild(img);
            
            const caption = document.createElement('div');
            caption.className = 'carousel-caption p-8 md:p-10 absolute bottom-0 left-0 w-full text-center opacity-0 transition-opacity duration-700 pointer-events-none flex flex-col justify-end';
            caption.innerHTML = `<span class="text-slate-900 dark:text-white font-extrabold text-xl md:text-3xl drop-shadow-lg tracking-widest">${data.label}</span>`;
            card.appendChild(caption);

            track.appendChild(card);
        });

        let currentAngle = 0;
        let activeIndex = 0;

        function updateCarouselStyles() {
            const cards = document.querySelectorAll('.carousel-card');
            const isMobile = window.innerWidth <= 768;
            cards.forEach((card, index) => {
                let diff = Math.abs((index - activeIndex) % numItems);
                if (diff > numItems / 2) diff = numItems - diff;
                
                const caption = card.querySelector('.carousel-caption');

                if (diff === 0) {
                    card.style.opacity = '1';
                    card.style.filter = isMobile ? 'none' : 'blur(0px) brightness(1.1)';
                    card.style.visibility = 'visible';
                    caption.style.opacity = '1';
                } else if (diff === 1) {
                    card.style.opacity = '0.6';
                    card.style.filter = isMobile ? 'none' : 'blur(3px) brightness(0.6)';
                    card.style.visibility = 'visible';
                    caption.style.opacity = '0';
                } else {
                    card.style.opacity = '0.2';
                    card.style.filter = isMobile ? 'none' : 'blur(8px) brightness(0.3)';
                    card.style.visibility = isMobile ? 'hidden' : 'visible';
                    caption.style.opacity = '0';
                }
            });
        }

        function rotateCarousel(direction = 'next') {
            if (direction === 'next') {
                currentAngle -= theta;
                activeIndex = (activeIndex + 1) % numItems;
            } else {
                currentAngle += theta;
                activeIndex = (activeIndex - 1 + numItems) % numItems;
            }
            track.style.transform = `translateZ(-${radius}px) rotateY(${currentAngle}deg)`;
            updateCarouselStyles();
        }

        track.style.transform = `translateZ(-${radius}px) rotateY(0deg)`;
        updateCarouselStyles();
        
        let autoRotate = setInterval(() => rotateCarousel('next'), 4000);

        document.getElementById('btnNext')?.addEventListener('click', () => {
            clearInterval(autoRotate);
            rotateCarousel('next');
            autoRotate = setInterval(() => rotateCarousel('next'), 4000);
        });

        document.getElementById('btnPrev')?.addEventListener('click', () => {
            clearInterval(autoRotate);
            rotateCarousel('prev');
            autoRotate = setInterval(() => rotateCarousel('next'), 4000);
        });
    }

    /* Navbar Mobile Menu Logic */
    const menuBtn = document.getElementById('hamburger-btn');
    const modal = document.getElementById('mobile-menu');
    const line1 = document.getElementById('line1');
    const line2 = document.getElementById('line2');
    let isOpen = false;

    const mobileLinks = document.querySelectorAll('.mobile-link');
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            isOpen = !isOpen;
            if(isOpen) {
                line1.classList.remove('-translate-y-1.5');
                line2.classList.remove('translate-y-1.5');
                line1.classList.add('rotate-45');
                line2.classList.add('-rotate-45');
                modal.classList.remove('opacity-0', 'pointer-events-none');
                modal.classList.add('opacity-100', 'pointer-events-auto');
                
                mobileLinks.forEach(link => {
                    link.classList.remove('translate-y-12', 'opacity-0');
                    link.classList.add('translate-y-0', 'opacity-100');
                });
            } else {
                line1.classList.remove('rotate-45');
                line2.classList.remove('-rotate-45');
                line1.classList.add('-translate-y-1.5');
                line2.classList.add('translate-y-1.5');
                modal.classList.remove('opacity-100', 'pointer-events-auto');
                modal.classList.add('opacity-0', 'pointer-events-none');
                
                mobileLinks.forEach(link => {
                    link.classList.add('translate-y-12', 'opacity-0');
                    link.classList.remove('translate-y-0', 'opacity-100');
                });
            }
        });

        document.querySelectorAll('.mobile-link').forEach(link => {
            link.addEventListener('click', () => {
                if(isOpen) menuBtn.click();
            });
        });
    }

    /* FAQ Logic */
    document.querySelectorAll('.faq-item').forEach(item => {
        item.addEventListener('click', () => {
            const isActive = item.classList.contains('active');
            document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
            if (!isActive) item.classList.add('active');
        });
    });

    /* Section Observers for Apple-style Reveal and Navigation Link Highlighting */
    const navLinks = document.querySelectorAll('nav a[href^="#"], #mobile-menu a[href^="#"]');
    
    function updateActiveNavLink(activeId) {
        navLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href === `#${activeId}`) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    let lastScrollY = window.scrollY;
    const sectionObserver = new IntersectionObserver((entries) => {
        const currentScrollY = window.scrollY;
        const isScrollingDown = currentScrollY > lastScrollY;
        lastScrollY = currentScrollY;

        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                entry.target.classList.remove('exit-up');
                
                // Update navigation highlighters
                const id = entry.target.getAttribute('id');
                // Only highlight if it's a primary section link, and not 'hero' since we don't have a hero nav link
                if (id && id !== 'hero') {
                    updateActiveNavLink(id);
                } else if (id === 'hero') {
                    // Clear all links if we scroll back to top/hero
                    updateActiveNavLink('');
                }
            } else {
                entry.target.classList.remove('active');
                if (isScrollingDown && entry.boundingClientRect.top < 0) {
                    entry.target.classList.add('exit-up');
                } else {
                    entry.target.classList.remove('exit-up');
                }
            }
        });
    }, { root: null, rootMargin: '-20% 0px -20% 0px', threshold: [0, 0.2, 0.8, 1] });

    document.querySelectorAll('.section-panel').forEach(section => {
        sectionObserver.observe(section);
    });

    // Also observe the FAQ container directly so that scrolling to FAQ updates the active link to #faq
    const faqContainer = document.getElementById('faq');
    if (faqContainer) {
        const faqObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    updateActiveNavLink('faq');
                } else if (!entry.isIntersecting) {
                    // If leaving FAQ, check if pricing is still active
                    const pricingSection = document.getElementById('pricing');
                    if (pricingSection && pricingSection.classList.contains('active')) {
                        updateActiveNavLink('pricing');
                    }
                }
            });
        }, { root: null, rootMargin: '-20% 0px -20% 0px', threshold: [0, 0.3, 0.8] });
        faqObserver.observe(faqContainer);
    }

    // Parallax Scroll Effect for Section Background Images
    const parallaxContainers = document.querySelectorAll('.section-bg-parallax');
    if (parallaxContainers.length > 0) {
        let isMobile = window.innerWidth <= 768;
        
        // Cache parent sections' layout offsetTop and offsetHeight to completely avoid layout thrashing/reflow on scroll
        let cachedSections = [];
        function cacheSectionMetrics() {
            isMobile = window.innerWidth <= 768;
            cachedSections = Array.from(parallaxContainers).map(container => {
                const parent = container.parentElement;
                // Calculate absolute top position in document
                let absoluteTop = 0;
                let el = parent;
                while (el) {
                    absoluteTop += el.offsetTop;
                    el = el.offsetParent;
                }
                return {
                    img: container.querySelector('img'),
                    absoluteTop: absoluteTop,
                    height: parent.offsetHeight
                };
            });
        }
        
        // Run cache initially and on window resize/orientation change
        cacheSectionMetrics();
        window.addEventListener('resize', cacheSectionMetrics);
        
        let ticking = false;
        window.addEventListener('scroll', () => {
            // Early exit on mobile screens to save processing/repaint overhead
            if (isMobile) return;
            
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    const viewportHeight = window.innerHeight;
                    const scrollY = window.scrollY;
                    
                    cachedSections.forEach(section => {
                        if (!section.img) return;
                        
                        // Calculate position relative to viewport using cached values
                        const relativeTop = section.absoluteTop - scrollY;
                        const relativeBottom = relativeTop + section.height;
                        
                        // Only animate if the section is currently in or near the viewport
                        if (relativeTop < viewportHeight && relativeBottom > 0) {
                            const scrollPercent = (viewportHeight - relativeTop) / (viewportHeight + 1000);
                            
                            const maxTranslate = 220;
                            let translateY = (scrollPercent * 2 - 1) * maxTranslate;
                            
                            if (translateY > maxTranslate) translateY = maxTranslate;
                            if (translateY < -maxTranslate) translateY = -maxTranslate;
                            
                            section.img.style.transform = `translateY(${translateY}px) scale(1.5)`;
                        }
                    });
                    ticking = false;
                });
                ticking = true;
            }
        });
    }

});

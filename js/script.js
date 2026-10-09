
const menuToggle = document.querySelector(".menu-toggle");
const mainNavigation = document.querySelector(".main-nav");

if (menuToggle && mainNavigation) {
    menuToggle.addEventListener("click", () => {
        const isOpen = menuToggle.getAttribute("aria-expanded") === "true";

        menuToggle.setAttribute("aria-expanded", String(!isOpen));
        mainNavigation.classList.toggle("is-open", !isOpen);
    });

    mainNavigation.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
            menuToggle.setAttribute("aria-expanded", "false");
            mainNavigation.classList.remove("is-open");
        }
    });
}
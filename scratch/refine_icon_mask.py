from PIL import Image, ImageDraw, ImageFilter

def refine_icon():
    # Load original generated image or current icon.png
    img = Image.open("icon.png").convert("RGBA")
    w, h = img.size
    
    # Supersampling 4x for smooth anti-aliased mask
    scale = 4
    mask_large = Image.new("L", (w * scale, h * scale), 0)
    draw = ImageDraw.Draw(mask_large)
    
    # Rounded rectangle coordinates inside the 512x512 box
    # Outer white padding in original image was ~34px diagonal (~24px horizontal/vertical)
    # Let's fit the rounded rectangle nicely
    margin = 24 * scale
    radius = 96 * scale  # Standard app icon corner radius
    
    draw.rounded_rectangle(
        [(margin, margin), (w * scale - margin, h * scale - margin)],
        radius=radius,
        fill=255
    )
    
    # Resize mask down to 512x512 with LANCZOS for super smooth anti-aliasing
    mask = mask_large.resize((w, h), Image.Resampling.LANCZOS)
    
    # Put this mask into alpha channel
    r, g, b, _ = img.split()
    smooth_img = Image.merge("RGBA", (r, g, b, mask))
    smooth_img.save("icon.png", "PNG")
    print("Smooth anti-aliased rounded transparent icon created.")

if __name__ == "__main__":
    refine_icon()

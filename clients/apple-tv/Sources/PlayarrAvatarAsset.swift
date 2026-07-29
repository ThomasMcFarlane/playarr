import SwiftUI
import UIKit

/// Profile avatar raster cropped from the authenticated SPA suite reference.
enum PlayarrAvatarAsset {
    static let pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAEQAAABECAIAAAC3cQTlAAAVBElEQVR4nM176XNc15XfOXd5S3cD3QCI" +
        "lSQ2LgI3ibQ2S7LsccnSeBZXMp6yx0lppjKVmqWy+NNU/op8S75MVb4lmap4XPFUeWzHHlu2bEmWNBqJ" +
        "MkWKFDcAxL70gl7ee3c5Jx9eAwQpkmYsQJODKhTe61ev7+/ec3/nnN89wLHhMQAAAAYOw7BYKFpjjTHM" +
        "DPcxBAQEALzP59z9+dRN5V8uUMRRHOjAZMY5dy8kiIiIApg9WecssQcmZs7HjYCIIn9GCi2lRhTMxMzw" +
        "aQFTCIAoCnFBa22MsdYyM+LtWUdAFIKZrUutS5QMByqHB3oni4U+JUOtIiUDAHA+Mz51NuukjerWfLU+" +
        "b1yiZaRVhEJuo9pnMMxQiOMgCLIsy0wmUNyBBJGYbNYWQvX1jg2UJyql0b7esb7ew4WoLFWoZKiEBgTn" +
        "MuNT67IkbdS2Fqpbi832Wm1rod5cclmmVSSE3G88OHV4Ko5j51yapnctCAMTeSFkKe4fqExOjJ6dGD1X" +
        "Lg4bnzmfee+IiZmICQCAu64GIJTUQgadtLawemFh5f3N+lw72fTeCSEQxP5tJzw1c8pkxhhz9wcAnpyW" +
        "0ejgI6eOvHho+IwQyrgOMwMgM+cswAwMvL0xiBiYgZkYCBiUDD279er1j2ZfXdm4bGwihNwnJACAx6aO" +
        "WWuJ6E7vkp6MktHRQ08/febrYVD05AGRiKA7dNjZ+sy0fbkDrHsTABgIAK2zH17/0Y1bb2S2LYXaJ39T" +
        "+ZrsRiJQWp/GYfnk9Atnjv12GJSIHDHl3pGPmRFQMEK+TF0iRu4uTZfCtsEColLhiemX4rD80dxPW+0N" +
        "KfR+OJv62B30ZEtx/6kjL5488qUoKGY2AWZABGBAQAHesrfsLXkPTOA9IQIgo2ChUGiWGomIt+MNs2cw" +
        "WkVThz4LiJdvvJKk1Xx37S1rfxwMoRAzk188ffRFrQuZaUmpvad8m9gOecNhGSqjGFWUjlAFIELwhl3G" +
        "NqVOnRorvrXppGYdIQogT0TsPVtshbowPvqE9/by9R8am6C4X9j9xGAQhCcnhDh6+NmZqd8KdKmT1Jll" +
        "mmZBKHyGABz3Q/GA6J8QlUnROyriHhEUQBeETcl2OG3x1qpfv+42rtvmuu/UnM9AhSCVCGNtMpeaVhAU" +
        "JsaeSNL6zYU3rUukCBhor8DgxMGJ/A9mAoTh/qNffPLf9RQHMtOWUmktlJbtVuqJymPi8NNy/HEV9gjy" +
        "TB6Y8i0PiDkvg5AgNNqE5t4xN99M12eNN9xbjkcPDszfWqtXW1qjQGVs+u6lb61uXGIGxD1ztu7KCCHS" +
        "rN3XO/bEia/GYYnIes9xQZ57cvrYzNjff+cddbB65ncLURmYwGXd7+5i2PU68kDEiDj5eHj4bHD5Z51L" +
        "/9BRgYxjJZCZCUB5dkLKI+OfT9LqZm02DErEfs/AICCzVyrs750c6j8qhHTeAIAnatQ67XYy83uoRnRx" +
        "AMkz/1o/ZwAAoUBoceqFYu+wvPiD9sWL8yZ1SkkiImBg6C9PlEuH61tLOXfvyeIIAEBEa7NKz+jUwccB" +
        "0ZNnZilF1rE3ri9fuHmxNGEqI4Ez7N3Dvtd7cIaDIh48GYycVK12J00tii67MTCDHxp8pNx72Plsd2D4" +
        "pGAAhXVpuTQyPnrWkyXywICCTUqdrBNPb4mQfIbMgAIgj498r7jHsPMBIqCErM0qEFNPFPuGQhRATNvh" +
        "ha3LBvqm+3oPen938nFPQ0R1p0kphRC7n1EAwEyBLvQWh+KonGZNBgZk71lo6DukDp2JpWaTghDAxAwg" +
        "lUBE8sTEO/RKxEKglJKZyTMAIyIDCI29w2roWNCsGZOSUNvTARyqUiHq16rwMD5mrW02m54Iu2kgSCXD" +
        "IFTqNiErBPTe9pfHB8oTzmW5E4BgZ7hQhqHjkjyjgNwRdKBQos0cESktUaN33dw+CBUzO+NRoA4kM5An" +
        "RiYHDDA6E9261O5sUagE5W7G7LyJ477e0kizvdL1kftboVAYGR7WSgOCQCTmLMuardbuDEYBoifb1zPW" +
        "Vz7syBF1M0hyrAvYO5bXY3lOycycte2Ni0uddjY63j94sC8HmeNZW6gv3tiIinr4cF9vXzH3ASYWEgbG" +
        "dRAL74gxT8aJATy5KOorFYcbzaW7HGa3d3nvpZInZ2b+/Z/9+eDAQLPVklI655ZXVn76i5+/9uab9Xo9" +
        "0JqYFQAQ+SgqR2HZeYfbmaL3LDTGZQEA5DkqhI1q+5XvnX/9ex9sLG8RkVTyqS898pV/83RlsDdLsr/7" +
        "b2+88YOLSSsD4J5K4akXZr788pODY5X6RkuHslBRUgERMSBRnuSBZxfoUhz2cR6w7luHAzBIIeIounb9" +
        "xqtvvN5sNfsrfefOPvbyN/4VCvH3/+cHgMhE3bJZqVCr0HkDgN2U2DMKkGHXu65dWPjZd95/+8dXauut" +
        "MAj6+8uNRuv7//2tTjP7w798/gf/4+2ff/dCu5FWKr1aqbkra41qZ/7a+kvfePyx56ZNZoNYCLUrz2Zg" +
        "YGKSUmsdb5PJgwjaExlr5xZuvfXOO+sb64U4XlhZ+o9/9hdnTpx86x/frjW2DgwMCABgIK0CpUJm2s52" +
        "GZC8Y5dyPmXe0uL1zdnLKz2V+Klnzvzh11469+Tx5YXNy+8toICr7y9W17Ymjox++fee+52vPN9TKWys" +
        "NGY/XK2tt5SSwOAtk+9yGTMz5DuNhNRSBQ9DAIgopWx32kvLS7MLcxub1TiMAq299416Y3Ro+F9/7Ws5" +
        "uQCiRBTMDEgAQACM7B2blAHAZm761NiZz06df/26d5R00s1qbWWx2jfY+9gzU30HSs/+7qn5a2v1jVar" +
        "1fG+RURM/OQLx898djJpGwA0CTkLAMSQzxcAMBEDCMSHLde898emj/7L3//9Wr3RX+l77pnPNlutd86/" +
        "t1mvPf+551/4whe6GYBzxrkMtrcyMIAAb6ldp0EABo5LwYmnxh97bvryP916/Rfvvvqzf1RKP/viqee/" +
        "cgaFePZ3Tn703sLPv3fh29/6ERMXe+KJY8OPfW56ZLx/q9aRUrSq1loPXXJnZgZkZvbePlScQWBm59wj" +
        "x46PjgyHYVgqFpvt9t9863+98eZbfZXK4GC/MVYBAKKwLs1skpdSDIQEUnGn7tcum4lzoQpEs5ocP3vw" +
        "q3/5uf/5n19Zma9liXn02al/8W+fOX7uoM18T6XwR9/8go7U69//II7DylDpa//hCyc+M95qZDoQzvDC" +
        "pSTZclIh5aoBABMjgKfMup0M4P7OxoAAWqn33n//77733TAMvvylF49OT6+urXWSThAGxlghRA4GrUuM" +
        "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"

    static var image: Image {
        guard let data = Data(base64Encoded: pngBase64),
              let ui = UIImage(data: data) else {
            return Image(systemName: "person.circle.fill")
        }
        return Image(uiImage: ui)
    }
}
